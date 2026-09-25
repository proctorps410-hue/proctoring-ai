import asyncio
import mimetypes
import os
from pathlib import Path, PurePosixPath
from typing import Any, Optional, Tuple

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from utils.logger import logger


class StorageService:
    _client = None
    _bucket_name = None
    _upload_timeout_seconds = float(os.getenv("MINIO_UPLOAD_TIMEOUT_SEC", "3.0"))
    _local_prefix = "local://"
    _local_root = Path(os.getenv("EVIDENCE_LOCAL_DIR", "./local_evidence")).resolve()

    @classmethod
    def _ensure_local_root(cls) -> None:
        cls._local_root.mkdir(parents=True, exist_ok=True)

    @classmethod
    def _is_local_key(cls, key: str) -> bool:
        return isinstance(key, str) and key.startswith(cls._local_prefix)

    @classmethod
    def _normalize_rel_key(cls, key: str) -> str:
        normalized = key.replace("\\", "/").strip()
        while normalized.startswith("/"):
            normalized = normalized[1:]
        normalized = str(PurePosixPath(normalized))
        if normalized in {"", ".", ".."}:
            raise ValueError("Invalid evidence key")
        if normalized.startswith("..") or "/../" in f"/{normalized}/":
            raise ValueError("Path traversal detected in evidence key")
        return normalized

    @classmethod
    def _local_key(cls, key: str) -> str:
        return f"{cls._local_prefix}{cls._normalize_rel_key(key)}"

    @classmethod
    def _resolve_local_path(cls, key: str) -> Path:
        rel = key[len(cls._local_prefix):] if cls._is_local_key(key) else key
        normalized = cls._normalize_rel_key(rel)
        root = cls._local_root.resolve()
        candidate = (root / Path(normalized)).resolve()
        if candidate != root and root not in candidate.parents:
            raise ValueError("Resolved local evidence path escapes root directory")
        return candidate

    @classmethod
    def get_client(cls):
        if cls._client is None:
            cls._bucket_name = os.getenv("MINIO_BUCKET_NAME", "evidence-bucket")
            minio_endpoint = os.getenv("MINIO_ENDPOINT") or "minio:9000"
            minio_secure = (os.getenv("MINIO_SECURE", "false").strip().lower() in {"1", "true", "yes"})
            minio_scheme = "https" if minio_secure else "http"
            minio_access_key = os.getenv("MINIO_ACCESS_KEY") or os.getenv("MINIO_ROOT_USER") or ""
            minio_secret_key = os.getenv("MINIO_SECRET_KEY") or os.getenv("MINIO_ROOT_PASSWORD") or ""

            cls._client = boto3.client(
                "s3",
                endpoint_url=f"{minio_scheme}://{minio_endpoint}",
                aws_access_key_id=minio_access_key,
                aws_secret_access_key=minio_secret_key,
                region_name="us-east-1",  # MinIO ignores this but boto3 requires it
                config=Config(
                    connect_timeout=float(os.getenv("MINIO_CONNECT_TIMEOUT_SEC", "0.8")),
                    read_timeout=float(os.getenv("MINIO_READ_TIMEOUT_SEC", "2.0")),
                    retries={"max_attempts": 1, "mode": "standard"},
                    tcp_keepalive=True,
                ),
            )
        return cls._client

    @classmethod
    def initialize(cls):
        """Ensure local evidence fallback and remote bucket are ready."""
        cls._ensure_local_root()
        logger.info(f"Local evidence fallback directory: {cls._local_root}")

        client = cls.get_client()
        try:
            client.head_bucket(Bucket=cls._bucket_name)
            logger.info(f"Storage bucket '{cls._bucket_name}' exists.")
        except ClientError:
            logger.info(f"Bucket '{cls._bucket_name}' not found. Creating...")
            try:
                client.create_bucket(Bucket=cls._bucket_name)
                logger.info(f"Bucket '{cls._bucket_name}' created successfully.")
            except Exception as e:
                logger.error(f"Failed to create bucket: {str(e)}")
                raise

    @classmethod
    async def upload_file(cls, file_data: bytes, filename: str, content_type: str = "image/jpeg") -> Any:
        """
        Upload evidence to MinIO when available.
        Falls back to local filesystem storage so Evidence Vault always has retrievable data.
        """
        cls._ensure_local_root()
        client = cls.get_client()

        def _put_object() -> str:
            client.put_object(
                Bucket=cls._bucket_name,
                Key=filename,
                Body=file_data,
                ContentType=content_type
            )
            return filename

        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_put_object),
                timeout=cls._upload_timeout_seconds,
            )
        except Exception as remote_exc:
            logger.warning(f"Remote upload failed for {filename}. Falling back to local storage: {remote_exc}")

            def _save_local() -> str:
                local_path = cls._resolve_local_path(filename)
                local_path.parent.mkdir(parents=True, exist_ok=True)
                with open(local_path, "wb") as handle:
                    handle.write(file_data)
                return cls._local_key(filename)

            try:
                return await asyncio.to_thread(_save_local)
            except Exception as local_exc:
                logger.error(f"Failed local evidence fallback for {filename}: {local_exc}")
                return None

    @classmethod
    def delete_file(cls, filename: str):
        """Delete evidence from remote or local fallback storage."""
        if cls._is_local_key(filename):
            try:
                local_path = cls._resolve_local_path(filename)
                if local_path.exists():
                    local_path.unlink()
                    logger.info(f"Deleted local evidence file: {filename}")
                return
            except Exception as e:
                logger.error(f"Failed to delete local evidence file {filename}: {str(e)}")
                return

        client = cls.get_client()
        try:
            client.delete_object(Bucket=cls._bucket_name, Key=filename)
            logger.info(f"Deleted file: {filename}")
        except Exception as e:
            logger.error(f"Failed to delete file {filename}: {str(e)}")

    @classmethod
    def download_file(cls, filename: str) -> Tuple[Optional[bytes], Optional[str]]:
        """Download a file from remote storage or local fallback and return bytes + content type."""
        if cls._is_local_key(filename):
            try:
                local_path = cls._resolve_local_path(filename)
                if not local_path.exists():
                    logger.warning(f"Local evidence file not found: {filename}")
                    return None, None
                content = local_path.read_bytes()
                content_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
                return content, content_type
            except Exception as e:
                logger.error(f"Failed to read local evidence file {filename}: {str(e)}")
                return None, None

        client = cls.get_client()
        response = None
        try:
            response = client.get_object(Bucket=cls._bucket_name, Key=filename)
            body = response["Body"].read()
            content_type = response.get("ContentType", "application/octet-stream")
            return body, content_type
        except Exception as e:
            logger.error(f"Failed to download file {filename}: {str(e)}")
            return None, None
        finally:
            if response and "Body" in response:
                response["Body"].close()
