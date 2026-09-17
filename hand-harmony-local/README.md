# Hand Harmony - Local

A local, single-camera version of Hand Harmony. Instead of syncing hand positions
between browser tabs over WebSockets, this version uses `ml5.bodyPose` (MoveNet,
multi-pose mode) to detect up to four people's wrists directly from one webcam feed,
so up to four people can stand in front of the same camera and play together.

## Differences from the original (`MostlaDay`)

- No `socket.io` / multiplayer networking - everything runs in one browser tab.
- Hand tracking switched from `ml5.handPose` (single person, up to 2 hands) to
  `ml5.bodyPose` with MoveNet's `MULTIPOSE_LIGHTNING` model, which detects the
  left/right wrists of up to 6 people at once (capped here at 4).
- Each detected person gets an assigned color; both of their wrists can play notes
  independently.

## Running it

```bash
cd hand-harmony-local
npm install
npm start
```

Then open `http://localhost:3000` and allow camera access. For best results, use a
wide-angle webcam and make sure all players are visible in frame.
