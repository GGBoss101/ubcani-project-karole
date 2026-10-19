# Admin login. A successful login stores a signed token in an HttpOnly cookie, which
# the browser then sends with every request; require_admin checks that cookie.
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
if not JWT_SECRET or not ADMIN_USERNAME or not ADMIN_PASSWORD:
    raise RuntimeError("JWT_SECRET, ADMIN_USERNAME, and ADMIN_PASSWORD must be set")

ADMIN_COOKIE_NAME = "karole_admin_token"
LOGIN_LIFETIME = timedelta(hours=5)

router = APIRouter(prefix="/auth", tags=["auth"])


async def require_admin(token: str | None = Cookie(default=None, alias=ADMIN_COOKIE_NAME)) -> dict:
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not logged in")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from error


@router.post("/login")
async def login(response: Response, form_data: OAuth2PasswordRequestForm = Depends()) -> dict[str, str]:
    # compare_digest raises TypeError on non-ASCII strings, so compare bytes instead.
    if not (
        hmac.compare_digest(form_data.username.encode(), ADMIN_USERNAME.encode())
        and hmac.compare_digest(form_data.password.encode(), ADMIN_PASSWORD.encode())
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = jwt.encode(
        {
            "sub": form_data.username,
            "exp": datetime.now(timezone.utc) + LOGIN_LIFETIME,
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    # HttpOnly keeps the token away from page scripts. SameSite=Lax means the browser only
    # sends it from pages on the same host as this server.
    response.set_cookie(
        key=ADMIN_COOKIE_NAME,
        value=token,
        max_age=int(LOGIN_LIFETIME.total_seconds()),
        httponly=True,
        samesite="lax",
    )
    return {"message": "Logged in"}


@router.post("/logout")
async def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(ADMIN_COOKIE_NAME)
    return {"message": "Logged out"}
