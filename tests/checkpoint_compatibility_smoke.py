"""Resume historical SQLite checkpoint bytes, including in a wheel-only environment."""
import base64
import json
import sqlite3
import sys
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from relohome_agent.agents.graph import checkpoint_serde
from relohome_agent.agents.models import TaskOutline


class State(TypedDict):
    outline: list[TaskOutline]
    selected: str


def verify(directory: Path, fixture: Path):
    record = json.loads(fixture.read_text())
    historical = (record['type'], base64.b64decode(record['payload']))
    serializer = checkpoint_serde()
    outline = serializer.loads_typed(historical)
    assert isinstance(outline[0], TaskOutline)

    builder = StateGraph(State)
    builder.add_node('plan', lambda state: {'outline': outline})
    builder.add_node('resume', lambda state: {'selected': state['outline'][0].selected})
    builder.add_edge(START, 'plan')
    builder.add_edge('plan', 'resume')
    builder.add_edge('resume', END)
    config = {'configurable': {'thread_id': 'pre-relohome'}}
    database = directory / 'checkpoints.sqlite3'
    # Frozen SQLite state was produced by the pre-migration application, not this serializer.
    database.write_bytes(base64.b64decode(record['sqlite']))
    assert b'src.agents.models' in database.read_bytes()
    with sqlite3.connect(database, check_same_thread=False) as connection:
        graph = builder.compile(checkpointer=SqliteSaver(connection, serde=serializer))
        snapshot = graph.get_state(config)
        assert isinstance(snapshot.values['outline'][0], TaskOutline)
        assert graph.invoke(None, config)['selected'] == 'offer-1'
    rewritten = serializer.dumps_typed(outline)
    assert rewritten == historical  # Byte-for-byte compatibility with the old writer.
    assert b'src.agents.models' in rewritten[1]
    assert b'relohome_agent.agents.models' not in rewritten[1]
    import ormsgpack
    from langgraph.checkpoint.serde.jsonplus import EXT_PYDANTIC_V2
    canonical = ormsgpack.packb(ormsgpack.Ext(EXT_PYDANTIC_V2, ormsgpack.packb((
        'relohome_agent.agents.models', 'TaskOutline',
        {'id': 'new-task', 'agent': 'flight'}, 'model_validate_json',
    ))))
    assert isinstance(serializer.loads_typed(('msgpack', canonical)), TaskOutline)
    # Keep the allowlist narrow: registering the old module must not allow other classes.
    import inspect

    import relohome_agent.agents.models as models
    expected = {(module, name) for name, obj in inspect.getmembers(models)
                if inspect.isclass(obj) and obj.__module__ in {models.__name__, 'src.agents.models'}
                for module in (models.__name__, 'src.agents.models')}
    assert serializer._allowed_msgpack_modules == expected


if __name__ == '__main__':
    verify(Path(sys.argv[1]), Path(sys.argv[2]))
