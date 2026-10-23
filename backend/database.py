import os

import pymongo
from dotenv import load_dotenv
from pymongo.errors import (
    DuplicateKeyError,
    OperationFailure,
    ConnectionFailure,
    ServerSelectionTimeoutError
)

load_dotenv()

mongo_uri = os.getenv("MONGODB_URI")
if not mongo_uri:
    raise RuntimeError("MONGODB_URI must be set")

client = pymongo.AsyncMongoClient(mongo_uri)["karole"]

try:
    client_init = pymongo.MongoClient(mongo_uri)
    col = client_init["karole"]["name"]
    col.create_index([("name_id",pymongo.DESCENDING)],unique=True)
    col.create_index("name",unique=True)
    col = client_init["karole"]["pending_operation"]
    col.create_index("po_id",unique=True)
    col.create_index("name_alt",unique=True)
    
except ConnectionFailure:
    print("Connection to mongodb failed")
    #484e50