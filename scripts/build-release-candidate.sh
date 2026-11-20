#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${1:?Specify a new directory outside the checkout}"
commit="$(git rev-parse HEAD)"
mkdir -- "$release_dir"
archive="$release_dir/flow-ai-engine-source.tar"
image_archive="$release_dir/flow-ai-engine-linux-amd64.tar.gz"
source_dir="$(mktemp -d)"
trap 'rm -rf -- "$source_dir"' EXIT

git archive --format=tar --output="$archive" "$commit"
tar -xf "$archive" -C "$source_dir"
build_id="source-$(bash "$source_dir/scripts/source-fingerprint.sh" "$source_dir")"
build_time="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
version="$(jq -er .version "$source_dir/package.json")"
tag="flow-ai-engine:release-${commit:0:12}"

docker build --platform linux/amd64 \
  --build-arg "BUILD_ID=$build_id" \
  --build-arg "BUILD_TIME=$build_time" \
  --label "org.opencontainers.image.revision=$commit" \
  --label "org.opencontainers.image.version=$version" \
  -t "$tag" "$source_dir"

[[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$tag")" == linux/amd64 ]]
builder_image_id="$(docker image inspect --format '{{.Id}}' "$tag")"
docker image save "$tag" | gzip -1 -n > "$image_archive"
gzip -t "$image_archive"

# Docker engines may report the OCI index digest or the config digest as Id.
# Verify and publish the config digest of the single runnable saved image.
config_path="$(tar -xOzf "$image_archive" manifest.json | jq -er --arg tag "$tag" \
  'select(length == 1 and .[0].RepoTags == [$tag]) | .[0].Config')"
[[ "$config_path" =~ ^(blobs/sha256/)?[a-f0-9]{64}(\.json)?$ ]]
image_config="$source_dir/.release-image-config.json"
tar -xOzf "$image_archive" "$config_path" > "$image_config"
jq -e --arg commit "$commit" --arg version "$version" \
  '.os == "linux" and .architecture == "amd64" and
   .config.Labels["org.opencontainers.image.revision"] == $commit and
   .config.Labels["org.opencontainers.image.version"] == $version' "$image_config" > /dev/null
config_hash="$(sha256sum "$image_config" | cut -d ' ' -f 1)"
[[ "$config_path" == "blobs/sha256/$config_hash" || "$config_path" == "$config_hash.json" ]]
image_id="sha256:$config_hash"

(
  cd "$release_dir"
  sha256sum flow-ai-engine-source.tar flow-ai-engine-linux-amd64.tar.gz > SHA256SUMS
)
jq -n --arg commit "$commit" --arg buildId "$build_id" --arg buildTime "$build_time" \
  --arg imageId "$image_id" --arg builderImageId "$builder_image_id" --arg imageTag "$tag" --arg version "$version" \
  '{commit:$commit,buildId:$buildId,buildTime:$buildTime,imageId:$imageId,builderImageId:$builderImageId,imageTag:$imageTag,version:$version,platform:"linux/amd64"}' \
  > "$release_dir/release-manifest.json"
