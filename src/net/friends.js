// Playing with friends through p3p2. This entry is small and asks no server anything on an
// ordinary visit; the race itself (race.js) and p3p2's room code load only once a room opens.
import { P3P2 } from '@p3p2/client';

export function friends(app) {
  // The version is the build: two builds may deal differently, so they never share a room.
  const p3p2 = new P3P2({ game: { id: 'bubbler', version: BUILD_ID }, ui: { button: false, chatKey: 't' } });
  for (const el of document.querySelectorAll('.game-host')) el.textContent = location.host;
  app.on('keysOff', () => P3P2.isTyping);
  app.on('friends', () => p3p2.open().catch(console.error));

  let race = null;
  p3p2.on('room', (room) => {
    import('./race.js')
      .then(({ Race }) => {
        if (p3p2.room !== room) return; // the room was over before the race code arrived
        race?.leave('left');
        race = new Race(room, app, p3p2);
      })
      .catch(console.error);
  });
  p3p2.on('leave', (reason) => {
    race?.leave(reason);
    race = null;
  });
  // Back into the room after a reload, or "Join?" for a page opened from an invite link.
  p3p2.start().catch(console.error);
}
