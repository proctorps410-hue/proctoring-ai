import sqlite3
import builtins

conn = sqlite3.connect('proctoring.db')
c = conn.cursor()
c.execute("SELECT id, email, role FROM users WHERE email='jvshayan1@gmail.com'")
builtins.print(c.fetchall())
conn.close()
