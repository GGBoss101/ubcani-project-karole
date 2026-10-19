from pydantic import BaseModel, Field, ConfigDict, model_validator, StringConstraints
from typing import Optional, Annotated
from dotenv import load_dotenv, dotenv_values 
import os
import re2 as re

load_dotenv()

max_length_name = os.getenv("MAX_NAME_LENGTH")

if (max_length_name != None): 
    max_length_name = int(max_length_name)
else:
    max_length_name = 30

# Song names can be longer than people's names.
max_length_song_name = 70

# Group 1 is the 11 character video id. The final optional group allows extra
# parameters after it, such as "?si=..." on share links or "&t=42s".
url_match = re.compile(r"^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|playlist\?|watch\?v=|watch\?.+(?:&|&#38;)v=))([a-zA-Z0-9\-_]{11})?(?:(?:\?|&|&#38;)index=((?:\d){1,3}))?(?:(?:\?|&|&#38;)?list=([a-zA-Z\-_0-9]{34}))?(?:[?&#].*)?$")
    
class NameInput(BaseModel):
    name: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
        
    model_config = ConfigDict(str_max_length=max_length_name)
    
class NameChange(BaseModel):
    name: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    name_alt: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    
    model_config = ConfigDict(str_max_length=max_length_name)

class NameEntry(BaseModel):
    name_id: int
    name: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    name_alt: list[Annotated[str, StringConstraints(pattern=r"^[\p{L}0-9_\s]+$")]]
    blacklist: bool
    
    model_config = ConfigDict(str_max_length=max_length_name)
    
class OperationInput(BaseModel):
    name: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    name_alt: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    score: float
    
    model_config = ConfigDict(str_max_length=max_length_name)
    
class OperationID(BaseModel):
    po_id: int
    
class OperationEntry(BaseModel):
    po_id: int
    name: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    name_alt: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    score: float
    model_config = ConfigDict(str_max_length=max_length_name)

class PlaylistInput(BaseModel):
    url: str = Field(max_length=100)
    name: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    song_name: str = Field(max_length=max_length_song_name, pattern=r"^[\p{L}0-9_\s*@#\^\&\%]+$")
    url_id: str | None = None
    service: str | None = None
    
    model_config = ConfigDict(str_max_length=max_length_name)
    
    @model_validator(mode="after")
    def extract(self):
        m = url_match.match(self.url)

        if not m:
            raise ValueError("Invalid YouTube Video URL")

        if (not m.group(1) or m.group(1) == "videoseries"):
            raise ValueError("Invalid YouTube Video URL")
            
        object.__setattr__(self, 'url_id', m.group(1))
        object.__setattr__(self, 'service', "youtube")
        return self
    
class PlaylistEntry(BaseModel):
    p_id: int
    order_num: int
    priority_num: int
    name_id: int
    time: float
    name: str = Field(pattern=r"^[\p{L}0-9_\s]+$")
    song_name: str = Field(max_length=max_length_song_name, pattern=r"^[\p{L}0-9_\s*@#\^\&\%]+$")
    service: str | None = None
    url: str = Field(max_length=100)
    url_id: str | None = None
    url_creator: str = Field(max_length=100)
    youtube_title: str = Field(max_length=100)
    url_channel_icon: str | None = Field(default=None, max_length=2048)
    # Length in seconds. is_too_long is set when it is over MAX_SONG_LENGTH_SECONDS,
    # and cleared again if the admin decides to keep the song.
    duration: float | None = None
    is_too_long: bool = False
    file_loc: Optional[str] = None
    is_downloaded: bool
    
    model_config = ConfigDict(str_max_length=max_length_name)

    @model_validator(mode="after")
    def validate_file_loc(self):
        if self.is_downloaded and not self.file_loc:
            raise ValueError("file_loc is required when is_downloaded is true")
        return self
    
class PlaylistSwap(BaseModel):
    original: int
    swap: int

class PlaylistMove(BaseModel):
    p_id: int
    order_num: int

class PlaylistJump(BaseModel):
    order_num: int

class QueueSettingsInput(BaseModel):
    open: bool