# Contributing

sentry-axi requires Node.js 24 or newer and uses npm.

## Set up the repository

Install the locked dependencies from `package-lock.json`:

```sh
npm ci
```

Development source runs directly as TypeScript. `npm run build` compiles the JavaScript published from `dist/`.

## Validate changes

Run the relevant focused checks while developing, then run the complete project check before committing:

```sh
npm run build
npm test
npm run check
```

`npm run check` verifies formatting, lint rules, types, the generated skill, and tests.

The committed `skills/sentry-axi/SKILL.md` is generated from `src/skill.ts`. Do not edit it directly. After changing the shared skill source, regenerate it with:

```sh
npm run build:skill
```

After changing package contents, also inspect the publishable files:

```sh
npm pack --dry-run
```
