from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from config.settings import settings
from utils.logger import logger
import os

Base = declarative_base()

def get_database_url():
    """Get database URL based on configuration.
    Tries multiple sources in order of priority so Railway, Docker, and local
    all work without any code changes.
    """
    # 1. Explicit DATABASE_URL / DATABASE_PRIVATE_URL (Railway reference variables)
    for url_key in ("DATABASE_URL", "DATABASE_PRIVATE_URL"):
        env_db_url = os.getenv(url_key)
        if env_db_url and any(p in env_db_url for p in ("postgres", "mysql", "sqlite")):
            if env_db_url.startswith("postgres://"):
                env_db_url = env_db_url.replace("postgres://", "postgresql://", 1)
            logger.info(f"Using {url_key} environment variable for database connection")
            return env_db_url

    # 2. Construct from PG* variables — Railway auto-injects these when services are linked
    pghost = os.getenv("PGHOST") or os.getenv("DATABASE_HOST")
    if pghost and pghost != "db":
        pguser = os.getenv("PGUSER") or os.getenv("POSTGRES_USER", "postgres")
        pgpassword = os.getenv("PGPASSWORD") or os.getenv("POSTGRES_PASSWORD", "")
        pgdatabase = os.getenv("PGDATABASE") or os.getenv("POSTGRES_DB", "railway")
        pgport = os.getenv("PGPORT", "5432")
        logger.info(f"Constructing PostgreSQL URL from PG* variables (host={pghost})")
        return f"postgresql://{pguser}:{pgpassword}@{pghost}:{pgport}/{pgdatabase}"

    # 3. Construct from POSTGRES_* settings vars (fallback when individual vars are set)
    pg_password = os.getenv("POSTGRES_PASSWORD", "")
    pg_user = os.getenv("POSTGRES_USER", "postgres")
    pg_db = os.getenv("POSTGRES_DB", "railway")
    pg_host = os.getenv("DATABASE_HOST", "")
    pg_port = os.getenv("DATABASE_PORT", "5432")
    if pg_host and pg_host != "db" and pg_password:
        logger.info(f"Constructing PostgreSQL URL from POSTGRES_* variables (host={pg_host})")
        return f"postgresql://{pg_user}:{pg_password}@{pg_host}:{pg_port}/{pg_db}"

    # 4. Fall back to settings object (reads from pydantic env vars)
    if settings.DB_TYPE.lower() == "sqlite":
        logger.info("Using SQLite database")
        return settings.SQLITE_URL

    if settings.DB_TYPE.lower() in ("postgres", "postgresql"):
        if settings.DB_HOST and settings.DB_HOST != "db":
            return (
                f"postgresql://{settings.DB_USER}:{settings.DB_PASSWORD}"
                f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
            )

    if settings.DB_TYPE.lower() == "mysql":
        return (
            f"mysql+mysqlconnector://{settings.DB_USER}:{settings.DB_PASSWORD}"
            f"@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
        )

    # 5. Last resort: SQLite so the app at least starts
    logger.warning("No valid database host found — falling back to SQLite. Set DATABASE_URL in environment.")
    return settings.SQLITE_URL

def create_db_engine():
    """Create database engine with proper configuration"""
    db_url = get_database_url()
    connect_args = {}
    
    if db_url.startswith('sqlite'):
        connect_args["check_same_thread"] = False
    
    try:
        engine = create_engine(
            db_url,
            pool_pre_ping=True,
            pool_recycle=3600,
            connect_args=connect_args
        )
        return engine
    except Exception as e:
        logger.error(f"Failed to create engine: {str(e)}")
        raise e
    return None

engine = create_db_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Synchronous database session dependency"""
    db = SessionLocal()
    try:
        yield db
    finally:
        if db is not None:
            db.close()

def get_async_db():
    """Async database session dependency"""
    db = SessionLocal()
    try:
        yield db
    finally:
        if db is not None:
            db.close()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
