CREATE DATABASE IF NOT EXISTS proctoring_ai;
USE proctoring_ai;

-- Create users table first since it's referenced by logs
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    image LONGBLOB
    face_embedding LONGBLOB
);

-- Create logs table with foreign key reference
CREATE TABLE IF NOT EXISTS logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    log VARCHAR(1000),
    event_type VARCHAR(100),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INT,
    session_id VARCHAR(100),
    is_deleted BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
