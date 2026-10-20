from fastapi import APIRouter, Depends, HTTPException, status
from database import client
from models import NameChange, NameInput, NameEntry, OperationInput, PlaylistEntry
from pending_operation import pending_operation
from playlist.playlist_store import playlist_store
from auth import require_admin
import pymongo, pymongo.errors
from rapidfuzz import fuzz
import concurrent.futures
import asyncio

col = client["name"]

router = APIRouter(
    prefix="/names",
    tags=["names"],
    dependencies=[Depends(require_admin)],
    responses={404: {"description": "Not found"}}
)

alt_to_name_op = {}

MAX_ATTEMPTS = 2

async def find_last_id() -> int:
    # The next free name_id: above every name, and above every song still in the queue. After
    # the names are flushed the queued songs keep their old name_ids, and a new name must not
    # take one over, or it would inherit that person's songs and turns.
    last_doc = await col.find().sort("name_id", -1).limit(1).to_list(1)
    highest = last_doc[0]["name_id"] if last_doc else -1
    for song in playlist_store.songs:
        highest = max(highest, song.name_id)
    return highest + 1

async def find_name(name: str) -> dict | None:
    # The name entry that has this as its main or alternate name.
    return await col.find_one({"$or": [{"name": name}, {"name_alt": name}]})

async def relink_restored_songs(songs: list[PlaylistEntry]) -> None:
    # Songs brought back from the log keep the name_ids they had then, which may not match
    # today's names. Each song is matched by the name it shows against today's names, main or
    # alternate, and belongs to that person; a name nobody has yet is added just as when a singer
    # adds a first song, merge suggestion included. Names already there are never changed, and
    # nothing moves in the queue.
    new_ids: dict[str, int] = {}
    for song in sorted(songs, key=lambda song: song.time):
        if song.name not in new_ids:
            try:
                new_ids[song.name] = (await read_name(NameInput(name=song.name)))["entry"].name_id
            except HTTPException:
                # The name was added, but suggesting a merge for it failed (one already exists).
                new_ids[song.name] = (await find_name(song.name))["name_id"]
        song.name_id = new_ids[song.name]

def find_sim(name: str, name_list: list[NameEntry]) -> tuple[float, NameEntry | None]:
    if not name_list:
        return (0, None)
    
    def calculate_score(entry):
        return fuzz.WRatio(name, entry.name), entry
    
    with concurrent.futures.ThreadPoolExecutor() as executor:
        scores_and_entries = list(executor.map(calculate_score, name_list))
    
    best_score, best_entry = max(scores_and_entries, key=lambda x: x[0])
    return (best_score, best_entry)
    
@router.put("/add")
async def read_name(body: NameInput, create_pending_operation: bool = True) -> dict:
    name_i = body.name
    
    name_ent = await col.find_one({"name": name_i})
    if name_ent:
        name_ent.pop("_id", None)
        return {"found": True, "entry": NameEntry(**name_ent)}
    
    name_ent = await col.find_one({"name_alt": name_i})
    if name_ent:
        name_ent.pop("_id", None)
        return {"found": True, "entry": NameEntry(**name_ent)}
    
    if name_i in alt_to_name_op.keys():
        return {"found": True, "entry": alt_to_name_op[name_i]}
    
    score, name_sim_ent = (0, None)
    if create_pending_operation:
        name_list = await get_names()
        score, name_sim_ent = await asyncio.to_thread(find_sim, name_i, name_list)
    
    insert_doc = {"name": name_i, "name_alt": [], "blacklist": False}
    for attempt in range(3):
        insert_doc["name_id"] = await find_last_id()
        try:
            await col.insert_one(insert_doc)
            break
        except pymongo.errors.DuplicateKeyError:
            existing = await col.find_one({"$or": [{"name": name_i}, {"name_alt": name_i}]})
            if existing:
                existing.pop("_id", None)
                return {"found": True, "entry": NameEntry(**existing)}
            if attempt == MAX_ATTEMPTS:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to allocate unique name_id")
            continue

    if create_pending_operation and score >= 70 and name_sim_ent:
        await pending_operation.add_operation(OperationInput(name=name_sim_ent.name, name_alt=name_i, score=score))

    return {"found": False, "entry": NameEntry(**insert_doc)}

@router.get("/")
async def get_names() -> list[NameEntry]:
    data = await col.find().to_list()
    names = []
    for i in data:
        names.append(NameEntry(**i))
    return names

@router.post("/to_alt")
async def name_to_alt(body: NameChange, combine_queues: bool = True) -> NameEntry:
    name_ent = await col.find_one({"name": body.name_alt})
    if (name_ent == None):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alt name not found")
    for i in name_ent["name_alt"]:
        name_ret = await col.find_one_and_update({"name":body.name},{"$addToSet":{"name_alt":i}})
    name_ret = await col.find_one_and_update({"name":body.name},{"$addToSet":{"name_alt":body.name_alt}}, return_document=pymongo.ReturnDocument.AFTER)
    if (name_ret == None):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Name not found")
    name_ent = await col.find_one_and_delete({"name": body.name_alt})
    # The merged name's queued songs now belong to this person: queue them again as their
    # next songs (or, with combine_queues off, only relabel them), the same as matching a
    # pending operation does.
    if name_ent is not None:
        playlist_store.requeue_songs_under_name(name_ent["name_id"], NameEntry(**name_ret), combine_queues)
    return NameEntry(**name_ret)

@router.post("/to_name")
async def alt_to_name(body: NameInput) -> NameEntry:
    try:
        name_ent = await col.find_one({"name": body.name})
        if (name_ent != None):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name already exists as primary")
        name_lock = await col.find_one({"name_alt": body.name})
        if (name_lock == None):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alt name not found")
        alt_to_name_op[body.name] = NameEntry(**name_lock)
        await col.find_one_and_update({"name_alt":body.name},{"$pull":{"name_alt":body.name}})
        insert_doc = {"name": body.name, "name_alt": [], "blacklist": False}
        for attempt in range(3):
            insert_doc["name_id"] = await find_last_id()
            try:
                await col.insert_one(insert_doc)
                break
            except pymongo.errors.DuplicateKeyError:
                existing = await col.find_one({"$or": [{"name": body.name}, {"name_alt": body.name}]})
                if existing:
                    existing.pop("_id", None)
                    alt_to_name_op.pop(body.name, None)
                    return NameEntry(**existing)
                if attempt == MAX_ATTEMPTS:
                    alt_to_name_op.pop(body.name, None)
                    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to allocate unique name_id")
                continue
        alt_to_name_op.pop(body.name, None)
        return NameEntry(**insert_doc)
    except Exception as e:
        alt_to_name_op.pop(body.name, None)
        raise e

@router.post("/blacklist")
async def blacklist(body: NameInput) -> NameEntry:
    name_ent = await col.find_one_and_update({"name":body.name},{"$set":{"blacklist":True}}, return_document=pymongo.ReturnDocument.AFTER)
    if (name_ent == None):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Name not found")
    return NameEntry(**name_ent)

@router.post("/unblacklist")
async def unblacklist(body: NameInput) -> NameEntry:
    name_ent = await col.find_one_and_update({"name":body.name},{"$set":{"blacklist":False}}, return_document=pymongo.ReturnDocument.AFTER)
    if (name_ent == None):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Name not found")
    return NameEntry(**name_ent)

@router.delete("/flush")
async def delete_all() -> None:
    await col.drop()
    await col.create_index([("name_id",pymongo.DESCENDING)],unique=True)
    await col.create_index("name",unique=True)
    
@router.delete("/delete")
async def delete(body: NameInput) -> NameEntry:
    result = await col.find_one_and_delete({"name": body.name})
    if (result == None):
        alt_result = await col.find_one_and_update({"name_alt":body.name},{"$pull":{"name_alt":body.name}})
        if alt_result:
            return NameEntry(**alt_result)
        else:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Name not found")
    return NameEntry(**result)