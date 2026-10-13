"""Package source files for local or Coolify resources without expanding runtime variables."""

import argparse
import shutil
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deploy/observability"
ENVIRONMENTS = ("staging", "production")


def dump(value):
    return yaml.safe_dump(value, sort_keys=False, width=140)


def selected_source(relative, target, environments):
    """Select native active/disabled files; never construct provisioning definitions."""
    for environment in ENVIRONMENTS:
        if target == f"/etc/grafana/provisioning/alerting/relohome-{environment}.yaml":
            directory = "grafana/alerts" if environment in environments else "grafana/alerts/disabled"
            return f"{directory}/{environment}.yaml"
        if target == f"/etc/cortex/rules/{environment}/expected-services.yaml":
            return (f"cortex-rules/{environment}/expected-services.yaml" if environment in environments
                    else "cortex-rules/disabled.yaml")
    return relative


def render(output: Path, *, kind="stack", coolify=False, environments=("staging",)):
    if set(environments) - set(ENVIRONMENTS):
        raise ValueError("Choose staging and/or production environments")
    output.mkdir(parents=True, exist_ok=True)
    filename = "compose.yaml" if kind == "stack" else "compose.collector.yaml"
    definition = yaml.safe_load((SOURCE / filename).read_text())
    for service in definition["services"].values():
        mounts = []
        for volume in service.get("volumes", []):
            if not volume.startswith("./"):
                mounts.append(volume)
                continue
            relative, target, *options = volume.split(":")
            relative = selected_source(relative.removeprefix("./"), target, environments)
            content = (SOURCE / relative).read_text()
            if coolify:
                # Coolify writes content verbatim; each consumer expands its own variables.
                mounts.append({"type": "bind", "source": "./" + relative, "target": target,
                               "read_only": True, "content": content})
            else:
                destination = output / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(content)
                mounts.append(":".join(["./" + relative, target, *options]))
        service["volumes"] = mounts
        if coolify:
            service.pop("ports", None)
            if service.get("restart") == "no":
                service["exclude_from_hc"] = True
    target = output / ("compose.coolify.yaml" if coolify else "compose.yaml")
    target.write_text(dump(definition))
    if not coolify:
        shutil.copyfile(SOURCE / ".env.example", output / ".env.example")
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--kind", choices=["stack", "collector"], default="stack")
    parser.add_argument("--coolify", action="store_true")
    parser.add_argument("--environments", nargs="+", choices=ENVIRONMENTS, default=["staging"])
    args = parser.parse_args()
    print(render(args.output, kind=args.kind, coolify=args.coolify, environments=args.environments))
