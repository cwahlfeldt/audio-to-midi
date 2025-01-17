# audio-to-midi

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

To try out:

```bash
curl -X POST -F "audio=@/path/to/audio.mp3/wav" http://localhost:3000 --output output.mid
```

This project was created using `bun init` in bun v1.1.43. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
