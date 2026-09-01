<div align="center">
  <a href="https://docs.blazingagents.com">
    <img src="https://raw.githubusercontent.com/blazingagents/docs/main/public/brand/icon.svg" alt="Blazing Agents logo" width="96">
  </a>
  <h1>Blazing Agents Skills</h1>
  <p>Reusable agent skills for building with Blazing Agents.</p>
  <p>
    <a href="https://docs.blazingagents.com/agents/skills">Documentation</a> ·
    <a href="https://skills.sh/blazingagents/skills">skills.sh</a>
  </p>
</div>

## Features

- Reusable instructions for coding agents working with Blazing Agents.
- Interactive installation of one or every skill in the repository.
- Support for Codex and other agents compatible with the `skills` CLI.
- Simple listing and update commands for installed skills.

## Install

List the skills in this repository:

```bash
npx skills add blazingagents/skills --list
```

Choose interactively:

```bash
npx skills add blazingagents/skills
```

Install the Blazing Agents skill:

```bash
npx skills add blazingagents/skills --skill blazing-agents
```

Install every skill in the repository:

```bash
npx skills add blazingagents/skills --all
```

Install globally for Codex without prompts:

```bash
npx skills add blazingagents/skills --skill blazing-agents --agent codex --global --yes
```

## Manage installed skills

```bash
npx skills list
npx skills update blazing-agents
```

See the [`skills` CLI documentation](https://skills.sh/docs/cli) for more options.

## Documentation

Read the [Blazing Agents Skills guide](https://docs.blazingagents.com/agents/skills)
to learn how Skills extend an Agent.

## License

[MIT](LICENSE)
