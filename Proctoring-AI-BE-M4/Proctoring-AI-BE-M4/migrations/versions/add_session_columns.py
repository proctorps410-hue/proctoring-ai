"""add session columns to logs

Revision ID: add_session_columns
Create Date: 2025-04-14 00:43:00
"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    # Add new columns
    op.add_column('logs', sa.Column('session_id', sa.String(100), nullable=True))
    op.add_column('logs', sa.Column('is_deleted', sa.Boolean(), nullable=True, server_default='0'))

def downgrade():
    # Remove columns
    op.drop_column('logs', 'is_deleted')
    op.drop_column('logs', 'session_id')
