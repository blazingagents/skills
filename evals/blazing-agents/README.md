# Blazing Agents Skill evals

These fixtures preserve the expected activation boundary and behavior of the
[`blazing-agents`](../../skills/blazing-agents/SKILL.md) skill. They are
maintenance evidence and are outside `skills/`, so the `skills` CLI does not
install them.

- `activation.json` covers requests that should and should not activate the skill.
- `behavior.json` covers routing, invariants, contract lookup, implementation,
  and verification expectations after activation.
