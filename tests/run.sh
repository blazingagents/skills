#!/bin/sh
set -eu

project=$(mktemp -d "${TMPDIR:-/tmp}/skills-tests.XXXXXX")
trap 'rm -rf "$project"' 0
cp -R scripts tests package.json "$project/"
mkdir "$project/snippets"
ln -s "$PWD/snippets/node_modules" "$project/snippets/node_modules"
cd "$project"
node --test --experimental-test-coverage \
  --test-coverage-include='**/scripts/*.mjs' \
  --test-coverage-lines=99 --test-coverage-branches=99 --test-coverage-functions=99 \
  tests/*.test.mjs
