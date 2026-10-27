# Stadium Crash Arena (6-player online browser game)

A small real-time multiplayer 2D car combat game using HTML Canvas, JavaScript, Node.js, Express and Socket.IO.

## Rules and controls
- Exactly **6 players** are required to start a match.
- Each player picks a name and enters the same room code.
- The game has **3 rounds**, each lasting **5 minutes**.
- Drive with **WASD** or the **arrow keys**. Hold **Space** to shoot while carrying a weapon.
- Weapon pickups spawn around the stadium. Types: machine gun, shotgun, rocket.
- A car can carry only one weapon at a time. Weapons expire after 12 seconds; while a weapon is attached, another pickup cannot be collected.
- Cars take damage from collisions, bullets and hitting the stadium wall.
- The round winner is the last surviving car, or the car with the most health when the timer expires. Tournament winner is the player with the most round wins (with small score credit for eliminations).

## Run locally
Install Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser. For local testing, use six browser tabs/windows and join the same room code with six different names.

## Host it for your team
This game needs a persistent Node.js server and WebSocket support. **GitLab Pages alone cannot host the live multiplayer server** because it serves static files only.

1. Push this folder to a GitLab repository.
2. Deploy the repository to a Node.js hosting service that supports WebSockets (for example, Render, Railway, Fly.io, or a VM).
3. Set the start command to `npm start`. The host should install dependencies with `npm install`.
4. Share the deployed HTTPS URL and one room code with all six players.

The frontend and Socket.IO client are served from the same server, so no separate API URL is needed.

## GitLab CI example
A generic CI pipeline can verify that the JavaScript parses. Add `.gitlab-ci.yml` if you want a basic validation pipeline; deployment configuration depends on the hosting provider.

## Notes
- This is a playable prototype, not a competitive anti-cheat implementation.
- A room is held in server memory; restarting the server clears rooms.
- If someone disconnects mid-game, they are removed from the room.
