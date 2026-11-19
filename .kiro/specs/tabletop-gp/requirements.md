# Requirements: TABLETOP GP (CursedGP)

A browser slot-car game with a haunted diorama mode. These requirements describe the game as built, followed by the requirements still open. Requirements use EARS templates.

## Racing
1. THE game SHALL race a car around a circuit chosen from a list of real track layouts, with a figure-eight as the default.
2. WHEN a race starts, THE game SHALL show a countdown with start lights and then the GO signal.
3. THE game SHALL count laps from 1, 3, 5, 8 or 10 laps, chosen on the title screen.
4. WHEN a car's speed exceeds its grip limit on a bend, THE game SHALL derail it off the slot, and it SHALL return to the slot after a short penalty.
5. THE game SHALL offer solo time trial, VS AI, and 1v1 online modes.
6. THE game SHALL offer three AI rivals (rookie, pro, maniac) with different throttle profiles.
7. WHEN a lap completes, THE game SHALL play a mechanical click sound and record the lap time.
8. THE game SHALL offer several car models, selectable through previous/next arrows and a garage overlay.

## Cameras and presentation
9. THE game SHALL offer four cameras in this order: TV cameras (default), chase, overview, and free orbit. The C key steps through them.
10. WHILE the title screen is idle, THE game SHALL preview a lap with a car and show rotating tips.
11. THE game SHALL show the camera in use as a numbered label while racing.
12. WHERE the device is a phone, THE game SHALL show the throttle as a vertical gauge on the right and the camera and locate controls on the left.

## Haunted mode
13. WHERE haunted mode is on, THE game SHALL spawn monsters and hazards on the track: a kaiju, a spider, a gargoyle, bat swarms, portals, pumpkins, skeletons, ghosts, and a poltergeist beam.
14. WHERE haunted mode is off, THE game SHALL show no monsters or pitfalls.
15. THE dark scenery (grass carpet, graveyards, forest, church, sky, storm) SHALL show in every mode.
16. WHEN a derailed car lands over the green grass, THE car SHALL rest on the grass rather than fall into empty space.
17. WHILE haunted mode is on, THE Shift key SHALL grant a 1.3-second immunity from hazards, three per lap, shown as a counter.
18. WHILE haunted mode is on, THE storm SHALL produce lightning, thunder and earthquakes at random intervals.
19. WHILE haunted mode is on, THE game SHALL play random wolf howls and creaks.

## Online 1v1
20. THE host SHALL publish a room, and a guest SHALL join it through a lobby over a real-time messaging service.
21. THE host SHALL decide every race event; THE guest SHALL replay the host's events.
22. THE public build SHALL obtain access tokens from a token server, and SHALL NOT contain the messaging key.
23. WHEN the host creates a room, THE lobby SHALL list it with the status WAITING FOR OPPONENT.

## Settings and quality
24. THE Quality control SHALL offer Low (50% render resolution), Medium (75%) and High (100%).
25. THE title screen SHALL show the haunted toggle as H (haunted) or V (vanilla).

## Open requirements
26. THE title screen SHALL show the logo on the still title only, not while a tip is on screen.
27. THE project SHALL include a demonstration video under three minutes, published on YouTube.
28. THE project SHALL include a README that describes only features that exist.
