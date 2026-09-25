from config.database import create_db_engine  # type: ignore
from models.base import Base  # type: ignore
from models.users import User  # type: ignore
from models.logs import Log  # type: ignore
from models.sessions import ExamSession  # type: ignore

def init_db():
    engine = create_db_engine()
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    print("Creating database tables...")
    init_db()
    print("Tables created successfully!")
