from pydantic import BaseModel, EmailStr, Field

class UserCreate(BaseModel):
    email: str = Field(..., pattern=r"^[\w\.-]+@[\w\.-]+\.\w+$")
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    message: str
    
from typing import Optional

class UserProfile(BaseModel):
    id: int
    email: str
    full_name: Optional[str] = None
    role: str
    department: Optional[str] = None
    has_image: bool = False

    class Config:
        from_attributes = True  # Pydantic v2 support (was orm_mode)

class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None
    email: Optional[EmailStr] = None

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    id: int
    role: str


class LoginAttemptResponse(BaseModel):
    attempt_id: str
    expires_in_seconds: int
    message: str = "Password verified. Complete face verification to sign in."


class LtiFaceBindResponse(BaseModel):
    verified: bool = True
    message: str = "Identity verified. You can continue to your exam."


class LivenessChallengeResponse(BaseModel):
    challenge_id: str
    pose_order: list[str]
    expires_in_seconds: int
    message: str = "Complete the face poses in the requested order."

