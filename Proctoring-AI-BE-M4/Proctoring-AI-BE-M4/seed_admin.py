import sys
import os
from sqlalchemy.orm import Session
import bcrypt

# Add parent directory to path
sys.path.append(os.getcwd())

from config.database import SessionLocal, engine
from models.base import Base
from models.users import User
from models.logs import Log
from models.sessions import ExamSession
from models.exams import Exam
from models.evidence import Evidence


def get_password_hash(password):
    return bcrypt.hashpw(password[:72].encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def _is_truthy(value: str) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}

def seed_admin():
    if not _is_truthy(os.getenv("SEED_DEFAULT_USERS", "false")):
        print("Default user seeding is disabled. Set SEED_DEFAULT_USERS=true to enable.")
        return

    # Create tables
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        email = (os.getenv("SEED_ADMIN_EMAIL") or "").strip()
        password = os.getenv("SEED_ADMIN_PASSWORD") or ""

        if not email or not password:
            print("Skipping admin seed: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not configured.")
        else:
            # Check if exists
            user = db.query(User).filter(User.email == email).first()
            if user:
                print(f"Admin user {email} already exists. Skipping creation.")
            else:
                print(f"Creating new admin user: {email}")
                user = User(
                    email=email,
                    password=get_password_hash(password),
                    full_name=os.getenv("SEED_ADMIN_NAME", "System Admin"),
                    role="admin"
                )
                db.add(user)
                db.commit()
                print("Admin user created successfully.")
        
        # Add optional student user (only when fully configured)
        student_email = (os.getenv("SEED_STUDENT_EMAIL") or "").strip()
        student_pass = os.getenv("SEED_STUDENT_PASSWORD") or ""
        if student_email and student_pass:
            student = db.query(User).filter(User.email == student_email).first()
            if student:
                print(f"Student user {student_email} already exists. Skipping creation.")
            else:
                print(f"Creating new student user: {student_email}")
                student = User(
                    email=student_email,
                    password=get_password_hash(student_pass),
                    full_name=os.getenv("SEED_STUDENT_NAME", "Seeded Student"),
                    role="student",
                    roll_number=os.getenv("SEED_STUDENT_ROLL", "SEED001"),
                    department=os.getenv("SEED_STUDENT_DEPARTMENT", "Computer Science")
                )
                db.add(student)
                db.commit()
                print("Student user created successfully.")
        else:
            print("Skipping student seed: SEED_STUDENT_EMAIL / SEED_STUDENT_PASSWORD not configured.")
            
    except Exception as e:
        print(f"Error seeding admin: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_admin()
