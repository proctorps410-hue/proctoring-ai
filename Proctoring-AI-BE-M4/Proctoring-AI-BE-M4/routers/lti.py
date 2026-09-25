from fastapi import APIRouter, Request, Depends, HTTPException, status
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse
from sqlalchemy.orm import Session
from config.database import get_db
from config.settings import settings
from models.users import User, UserRole
from routers.auth import create_access_token
from utils.lti_adapter import FastAPIRequest, FastAPICookieService, FastAPIOIDCLogin, FastAPIMessageLaunch
from utils.logger import logger
from pylti1p3.tool_config import ToolConfDict
from pylti1p3.session import SessionService
import bcrypt
import secrets

router = APIRouter(
    prefix="/api/v1/lti",
    tags=["LTI 1.3"]
)

def get_lti_config():
    """
    Construct LTI Configuration from Settings.
    """
    return {
        settings.LTI_ISSUER: [{
            "client_id": settings.LTI_CLIENT_ID,
            "auth_login_url": settings.LTI_AUTH_URL,
            "auth_token_url": settings.LTI_TOKEN_URL,
            "key_set_url": settings.LTI_JWKS_URL,
            "private_key": settings.LTI_PRIVATE_KEY,
            "public_key": settings.LTI_PUBLIC_KEY,
            "deployment_ids": ["1", "2", "3"] # Allow any deployment for now
        }]
    }

@router.get("/jwks")
def get_jwks():
    """
    Serve our Public Key Set (JWKS) so the LMS can verify our messages.
    """
    tool_conf = ToolConfDict(get_lti_config()) # type: ignore
    return tool_conf.get_jwks()

@router.api_route("/login", methods=["GET", "POST"])
async def lti_login(request: Request):
    """
    OIDC Login Initiation Endpoint.
    """
    try:
        # Extract params
        params = dict(request.query_params)
        
        form_data = {}
        if request.method == "POST":
            form_data = {k: str(v) for k, v in (await request.form()).items()}
            
        params.update(form_data)
        
        target_link_uri = params.get("target_link_uri", str(request.url))
        
        # Create adapter
        lti_request = FastAPIRequest(
            method=request.method,
            url=str(request.url),
            cookies=request.cookies,
            session=request.session,
            params=params,
            data=form_data
        )

        tool_conf = ToolConfDict(get_lti_config()) # type: ignore
        session_service = SessionService(lti_request)
        cookie_service = FastAPICookieService(request.cookies)
        
        # Start OIDC Login
        oidc_login = FastAPIOIDCLogin(lti_request, tool_conf, session_service, cookie_service)
        launch_result = oidc_login.enable_check_cookies().redirect(target_link_uri)
        
        if isinstance(launch_result, str):
            # It's the cookie check HTML
            return HTMLResponse(content=launch_result)
            
        resp = RedirectResponse(url=launch_result.location, status_code=302)
        
        # Important: Set cookies that OIDCLogin wanted to set (Required for iframes)
        for name, value in cookie_service.get_cookies_to_set().items():
            resp.set_cookie(
                key=name, 
                value=value, 
                max_age=3600, 
                samesite="none", 
                secure=True,
                httponly=True
            )
            
        return resp
        
    except Exception as e:
        logger.error(f"LTI Login Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"LTI Login Failed: {str(e)}")

@router.api_route("/launch", methods=["GET", "POST"])
async def lti_launch(request: Request, db: Session = Depends(get_db)):
    """
    LTI Launch Endpoint.
    """
    try:
        form_data = {}
        if request.method == "POST":
            form_data = {k: str(v) for k, v in (await request.form()).items()}
            
        params = dict(request.query_params)
        params.update(form_data)
        
        # Log cookies for debugging
        logger.info(f"Launch Request Cookies: {request.cookies}")
        
        lti_request = FastAPIRequest(
            method=request.method,
            url=str(request.url),
            cookies=request.cookies,
            session=request.session,
            params=params,
            data=form_data
        )

        tool_conf = ToolConfDict(get_lti_config()) # type: ignore
        session_service = SessionService(lti_request)
        cookie_service = FastAPICookieService(request.cookies)
        
        # Validate Launch
        message_launch = FastAPIMessageLaunch(lti_request, tool_conf, session_service, cookie_service)
        
        # verify() raises exceptions if invalid
        launch_data = message_launch.get_launch_data()
        
        logger.info(f"LTI Launch Successful: {launch_data.get('email', 'No Email')}")
        
        # Extract User Info
        email = launch_data.get("email")
        if not email:
            logger.warning("LTI Launch missing email.")
            raise HTTPException(status_code=400, detail="University did not provide email address.")

        name = launch_data.get("name", "LTI User")
        roles = launch_data.get("https://purl.imsglobal.org/spec/lti/claim/roles", [])
        
        # Identity Security: Domain Check
        allowed_domains = settings.ALLOWED_EMAIL_DOMAINS
        if allowed_domains and "*" not in allowed_domains:
            domain = email.split("@")[-1]
            if f"@{domain}" not in allowed_domains:
                raise HTTPException(status_code=403, detail="Email domain not authorized for this exam.")

        # Determine Role
        is_instructor = any("Instructor" in r or "Administrator" in r for r in roles)
        app_role = UserRole.ADMIN if is_instructor else UserRole.STUDENT
        
        # User Provisioning
        user = db.query(User).filter(User.email == email).first()
        if not user:
            logger.info(f"Creating new LTI user: {email}")
            random_pw = secrets.token_urlsafe(16)
            hashed = bcrypt.hashpw(random_pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            
            user = User(
                email=email,
                password=hashed,
                full_name=name,
                role=app_role,
                image=None 
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            if is_instructor and user.role != UserRole.ADMIN:
                logger.info(f"Upgrading user {email} to Admin via LTI")
                user.role = UserRole.ADMIN
                db.commit()

        # Generate JWT
        access_token = create_access_token(data={"sub": user.email})
        
        # Route users through the student frontend callback, which dispatches
        # to admin/student destinations based on role.
        frontend_url = (settings.STUDENT_FRONTEND_URL or "").rstrip("/")
        if not frontend_url:
            raise HTTPException(
                status_code=500,
                detail="STUDENT_FRONTEND_URL is not configured"
            )

        redirect_url = f"{frontend_url}/lti/callback?token={access_token}&role={user.role}&userId={user.id}"
        
        return RedirectResponse(url=redirect_url, status_code=302)

    except Exception as e:
        logger.error(f"LTI Launch Error: {str(e)}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"error": f"LTI Launch Validation Failed: {str(e)}"}
        )
