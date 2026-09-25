from pydantic import BaseModel
from typing import Optional, Any

class ErrorResponse(BaseModel):
    detail: str
    status_code: int = 400
    data: Optional[Any] = None

class SuccessResponse(BaseModel):
    message: str
    status_code: int = 200
    data: Optional[Any] = None
