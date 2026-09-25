"""add policy_audit table

Revision ID: add_policy_audit_table
Revises: add_session_columns
Create Date: 2026-04-10
"""

from alembic import op
import sqlalchemy as sa


revision = "add_policy_audit_table"
down_revision = "add_session_columns"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "policy_audit",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("exam_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=24), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("trigger_source", sa.String(length=32), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("thresholds", sa.JSON(), nullable=True),
        sa.Column("trigger_event_types", sa.JSON(), nullable=True),
        sa.Column("evidence_url", sa.String(length=512), nullable=True),
    )

    op.create_index("ix_policy_audit_created_at", "policy_audit", ["created_at"])
    op.create_index("ix_policy_audit_user_id", "policy_audit", ["user_id"])
    op.create_index("ix_policy_audit_session_id", "policy_audit", ["session_id"])
    op.create_index("ix_policy_audit_exam_id", "policy_audit", ["exam_id"])


def downgrade():
    op.drop_index("ix_policy_audit_exam_id", table_name="policy_audit")
    op.drop_index("ix_policy_audit_session_id", table_name="policy_audit")
    op.drop_index("ix_policy_audit_user_id", table_name="policy_audit")
    op.drop_index("ix_policy_audit_created_at", table_name="policy_audit")
    op.drop_table("policy_audit")

