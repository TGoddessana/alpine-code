"""``data/*``: the data of a project's web app for the 데이터 tab.

The practice data (the local database) can be edited; the live data (the published app's) only read, because changes
to live data go through the AI and its approval. The work is in ``alpine_core.cloud.data``; it blocks, so it runs on a
thread.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from alpine_core.cloud import CloudError, SignedOut
from alpine_core.cloud import data as cloud_data
from alpine_protocol.cloud import (
    DataDeleteParams,
    DataDeleteResult,
    DataReadsParams,
    DataReadsResult,
    DataRowsParams,
    DataRowsResult,
    DataSaveParams,
    DataSaveResult,
    DataSourcesResult,
    DataTablesParams,
    DataTablesResult,
    PublishCwdParams,
)

from .cloud import method_error
from .methods import APP_ERROR, MethodError


class DataMethods:
    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {
            "data/sources": self.sources,
            "data/tables": self.tables,
            "data/rows": self.rows,
            "data/save": self.save,
            "data/delete": self.delete,
            "data/reads": self.reads,
        }

    async def sources(self, params: PublishCwdParams) -> DataSourcesResult:
        found = await _run(cloud_data.sources, _folder(params.cwd))
        return DataSourcesResult.model_validate({"sources": found})

    async def tables(self, params: DataTablesParams) -> DataTablesResult:
        found = await _run(cloud_data.tables, _folder(params.cwd), params.source)
        return DataTablesResult.model_validate(
            {"tables": [{"name": t.name, "rows": t.rows, "columns": t.columns} for t in found]}
        )

    async def rows(self, params: DataRowsParams) -> DataRowsResult:
        found = await _run(
            cloud_data.rows,
            _folder(params.cwd),
            params.source,
            params.table,
            limit=params.limit,
            offset=params.offset,
            order=params.order,
            dir=params.dir or "asc",
        )
        return DataRowsResult.model_validate(found)

    async def save(self, params: DataSaveParams) -> DataSaveResult:
        await _run(cloud_data.save, _folder(params.cwd), params.source, params.table, params.key, params.cells)
        return DataSaveResult()

    async def delete(self, params: DataDeleteParams) -> DataDeleteResult:
        await _run(cloud_data.delete, _folder(params.cwd), params.source, params.table, params.key)
        return DataDeleteResult()

    async def reads(self, params: DataReadsParams) -> DataReadsResult:
        found = await _run(cloud_data.reads, _folder(params.cwd))
        return DataReadsResult.model_validate({"reads": found})


async def _run(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    except cloud_data.DataError as e:
        raise MethodError(APP_ERROR, e.message, e.code if e.code in _REASONS else "other") from e
    except (CloudError, SignedOut) as e:
        raise method_error(e) from e


#: The ``DataError`` codes that are protocol reasons as they are.
_REASONS = {"read_only", "not_found", "not_available", "invalid"}


def _folder(cwd: str) -> Path:
    folder = Path(cwd).expanduser().resolve()
    if not folder.is_dir():
        raise MethodError(APP_ERROR, f"{cwd} is not a folder", "not_a_folder")
    return folder
