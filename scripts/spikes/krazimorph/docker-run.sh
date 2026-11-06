#!/usr/bin/env sh
# Runs the kraziMorph spike on the Docker host where kraziTV and Plex live.
#
# It stops the running kraziTV container and starts a second one from the
# same image, with the same volumes, ports, and environment (so Plex sees
# the same data, tuner identity, and PUBLIC_BASE_URL), plus this folder and
# the fixtures mounted in and the preload turned on through NODE_OPTIONS.
#
# Usage, from a clone of the repo on that host:
#   sh scripts/spikes/krazimorph/docker-run.sh off      # the control
#   sh scripts/spikes/krazimorph/docker-run.sh native
#   sh scripts/spikes/krazimorph/docker-run.sh auto
#
#   KRAZITV_CONTAINER   the real container's name          (default krazitv)
#   KRAZIMORPH_FIXTURES host folder holding the clips      (default data/krazimorph/fixtures)
#   KRAZIMORPH_CEILING  480 | 720 | 1080                    (default 1080)
#
# The spike container runs in the foreground and prints the server log with
# the `krazimorph` decision lines. Ctrl-C ends it; then
#   docker start krazitv
# brings the real one back.

set -eu

mode="${1:?usage: docker-run.sh off|native|auto}"
real="${KRAZITV_CONTAINER:-krazitv}"
here="$(cd "$(dirname "$0")" && pwd)"
fixtures="$(cd "${KRAZIMORPH_FIXTURES:-$here/../../../data/krazimorph/fixtures}" && pwd)"

image="$(docker inspect -f '{{.Config.Image}}' "$real")"
network="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$real")"

# The real container's bind mounts and named volumes, as -v flags.
volumes="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}-v {{.Name}}:{{.Destination}}{{else}}-v {{.Source}}:{{.Destination}}{{end}}{{if not .RW}}:ro{{end}} {{end}}' "$real")"

# Its environment, minus PATH, which the image sets itself.
envs="$(docker inspect -f '{{range .Config.Env}}{{.}}
{{end}}' "$real" | grep -v '^PATH=' | sed 's/^/-e /' | tr '\n' ' ')"

if [ "$network" = "host" ]; then
  ports="--network host"
else
  ports="$(docker inspect -f '{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}-p {{.HostPort}}:{{$port}} {{end}}{{end}}' "$real")"
fi

echo "stopping $real"
docker stop "$real" >/dev/null
docker rm -f krazimorph >/dev/null 2>&1 || true

echo "starting krazimorph from $image in mode $mode"
# shellcheck disable=SC2086
exec docker run --rm --name krazimorph $ports $volumes $envs \
  -v "$here:/spike:ro" \
  -v "$fixtures:/media/krazimorph:ro" \
  -e NODE_OPTIONS=--import=/spike/preload.mjs \
  -e KRAZIMORPH_MODE="$mode" \
  -e KRAZIMORPH_CEILING="${KRAZIMORPH_CEILING:-1080}" \
  "$image"
