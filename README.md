# True Wind

[![The Blackwatch 19/24 under tanbark sails off Puerto Progreso](docs/preview.jpg)](https://hclivess.github.io/truewind/)

A browser sailing simulator where the boat is not animated — it is computed. Every frame, the wind on each strip of each sail, the shape your strings give that sail, the lift of the keel and rudder, the resistance of the hull, the heel, the waves and the tide are solved as forces and moments on a rigid body, 120 times a second.

**Play:** https://hclivess.github.io/truewind/

It runs in any modern browser with WebGL, with no install and no build step.

## What you can sail

| Boat | What it is |
|---|---|
| **Blackwatch 19/24** | Dave Autry's 1979 pocket bluewater cutter from Blue Water Boatworks (81 built, 1979–81). LOA 5.64 m (nearly 24 ft with the bowsprit), LWL 5.33 m, beam 2.29 m, draft 0.61 m, 1,021 kg with 363 kg of iron ballast, 19.7 m² of sail. Long keel, transom-hung rudder, teak bowsprit, self-tacking staysail, flying jib, double-reefed main. Its home port in the sim is **Progreso, Yucatán**. |
| **Sportboat 23** | A 7 m one-design keelboat with four crew, a carbon mast and an asymmetric gennaker. It planes downwind from about 13 kn of wind. |
| **Singlehander 14** | A 4.2 m una-rig Olympic-style dinghy with one sailor, a bendy unstayed mast and a daggerboard. It capsizes. |
| **Beach Cat 16** | A 5 m beach catamaran with two crew on trapeze, twin daggerboards and rudders, and a gennaker. It flies a hull from about 10 kn and pitchpoles if you bury the bows. |

Each class has its own sailcloth: tanbark Dacron on the Blackwatch, a grey tri-radial laminate with draft stripes on the sportboat, white Dacron on the dinghy. The cloth shows its seams, batten pockets, reef points and corner patches, and the sun shines through it. Telltales on the luff and on the main's leech stream while the flow is attached and lift or curl when it luffs or stalls.

## Where you can sail

These venues use real OpenStreetMap coastlines, lakes and piers, baked into `data/venues/`:

- Puerto Progreso (Yucatán)
- The Solent
- San Francisco Bay
- Lake Garda
- Sydney Harbour
- Kiel Fjord
- Narragansett Bay
- Hauraki Gulf
- Rade de Marseille
- Lake Meredith (Texas)
- Open water

You can also type any latitude and longitude on Earth. The game then downloads that coastline live from the Overpass API. **Use live wind here** fetches the current wind and gusts for the venue from Open-Meteo.

## Modes

- **Free sail.** You sail anywhere. Click the tactical map to drop a waypoint, and the instruments switch to VMC (velocity made good on course) with laylines. Time warp is available up to ×8.
- **Race.** A windward–leeward course is laid automatically in open water on the real map. It has a start sequence with signals, an OCS (over the line early) call with a dip-back requirement, a windward mark rounded to port, a leeward gate and a finish. The AI fleet sails the same physics as you do.

## Online: a shared world

Pick **Online**, then type a name and a room (or leave it on `public`). Everyone who chooses the same venue and room sails in one world. Boats can be different classes: a Blackwatch can share Progreso with dinghies.

- **No game server.** Browsers connect directly to each other over WebRTC. They find each other through public Nostr relays using [Trystero](https://github.com/dmotz/trystero), so the game still runs from static GitHub Pages.
- **Same weather for everyone.** Wind puffs, shifts and waves are deterministic functions of a seed, position and time. The first sailor in a room sets the seed, the conditions and the clock, and later arrivals adopt them.
- **Each browser owns its boat.** It simulates its own boat and streams the state 10 times a second. Other boats are re-simulated locally from their control inputs, so their sails, heel and trim look right, and are continuously pulled toward the received position.
- **Shared races.** Anyone can press **Start a race for the room**. Every browser then builds the same windward–leeward course from the real map and the wind, with the same gun time, and standings include everyone.

WebRTC needs a network that allows peer connections. Strict corporate firewalls can block them.

## The physics

Everything is in `js/physics.js` (boat), `js/env.js` (wind, waves, current) and `js/world.js` (map, depth, shelter).

### Rigid body
The boat moves in surge, sway, roll and yaw in SNAME body axes, with added mass and Coriolis coupling:
`(m+mₓ)(u̇ − v r·m_y/m_x) = X`, `(m+m_y)(v̇ + u r·m_x/m_y) = Y`, `I_z ṙ = N − (m_y − m_x)·u v`, `I_x ṗ = K`.
The last yaw term is the Munk moment, where m_x and m_y are the added masses. A hull moving at a drift angle carries more water sideways than lengthwise, so the flow turns it broadside. With leeway this adds weather helm. In a turn, where the bow points inside the track, it tightens the turn.
Heave and pitch respond as damped oscillators to the wave elevation along the hull. The response includes bow-down trim from sail drive, squat, crew fore-aft trim, and the bow lifting as the boat starts to plane.

### Sails: strip theory with shape
Each sail is split into three horizontal strips. For each strip, per step:

1. **Apparent wind.** The true wind comes from a neutral log boundary layer, `U(h) = U₁₀ ln(h/z₀)/ln(10/z₀)`, with z₀ taken from Charnock roughness. The strip's own velocity is subtracted from it: surge, sway, yaw rate × lever arm, roll rate × height, and the boom's swing. The result is projected into the heeled rig plane (the cos φ effective-angle correction). Air density is 1.225 kg/m³, except in the rain-cooled outflow under a squall. That air is up to about 9 K colder, so it is about 3% denser and pushes harder than its wind speed alone suggests.
2. **Shape from the rig.** Each strip's camber depth, draft position and twist are set by the controls a real crew uses:
   - **Mainsheet:** leech tension when hard in.
   - **Traveler:** boom angle at constant leech tension.
   - **Vang:** leech tension when eased, plus mast bend on a bendy rig.
   - **Cunningham:** draft forward, slightly flatter.
   - **Outhaul:** foot depth.
   - **Backstay:** mast bend (flatter, more open upper main) and forestay tension (less headstay sag).
   - **Jib car:** foot depth against leech twist.
   - **Jib halyard:** draft position.
   - **Gennaker tack line:** luff rotation and twist.
   - **Reefs:** area, luff length and depth.
   
   Load matters too: cloth stretch deepens the sail and pulls the draft aft, and headstay sag grows with dynamic pressure.
3. **Coefficients from shape.** Maximum lift grows with depth. The stall angle grows with depth and with the draft being forward. The luffing angle grows with depth and a round entry, so flat sails point higher. Separation drag rises when the draft moves aft. Induced drag is `C_L²/(π·AR_e)`. Beyond stall the coefficients blend into flat-plate behaviour, which is what drives a boat on a dead run.
4. **Interaction.** The headsail's downwash lowers the main's angle of attack, so an over-trimmed jib backwinds the main. The main's upwash lifts the headsail. On a deep run the main blankets the headsails, and every boat casts a cone of dirty air along its apparent wind.

Each strip's force is applied at its own centre of effort, so heel moment, weather helm (the drive's lever arm grows as the rig heels) and yaw all come out of the geometry rather than being tuned in.

### Sails as cloth over a vortex lattice (opt-in: `?sails=cloth`)
Add `?sails=cloth` to the address to sail the player's boat with sails that are simulated cloth, loaded by a vortex-lattice model of the air over their live shape (`?sails=vlm` keeps the rig-set shapes above and puts only the lattice under them). The AI boats, the online boats and the velocity prediction still use the strip model.

- **Cloth** (`js/sail/cloth.js`). Each sail is a membrane cut to its sailmaker's moulded shape, with separate stiffness along the warp, along the fill and on the bias (cross-cut Dacron on the Blackwatch and the dinghy, tri-radial laminate on the sportboat and the cat, light nylon for the gennakers). It carries no compression: it wrinkles instead. It is integrated with projective dynamics (implicit, four substeps per step), which is stable for stiff sailcloth and gives the static stretch exactly (`node test/cloth.mjs`). The air a sail carries with it is part of its mass.
- **Rig** (`js/sail/rigsim.js`). The luff is held on the mast or on the stay, and the stay sags to leeward with load and less backstay. The boom is a body on its gooseneck held by ropes: the mainsheet to the traveller car, the vang and a topping lift. The outhaul moves the clew along the boom, the cunningham tensions the luff, and mast bend moves the luff forward against the luff round cut into the sail. Headsails are held by two sheets to the jib cars, and the car's position decides whether the sheet pulls along the foot or down the leech. Twist, boom lift, a hooked or open leech, a backed jib and the clew crossing in a tack all come out of that. A reef makes the sail smaller.
- **Air** (`js/sail/vlm.js`). All the sails form one vortex lattice with a frozen wake, and the water surface acts as a mirror. The headsail's downwash on the main, the slot and a backed jib pushing on the main therefore come from the flow itself. The sail's own motion is part of the boundary condition, which gives the aerodynamic damping. A viscous correction pulls each strip's lift onto a 2-D section polar at its effective angle of attack (decambering). Strips past the stall, or with the wind coming over the leech, take the polar's separated-flow force. Separated strips cast a wake of slow air on the sails behind them. A strip that carries almost no lift gets a travelling pressure wave, so a luffing sail flogs. The lattice's lift acts on the cloth normal to it, and its leading-edge suction acts on the mast or stay.
- **Coupling.** The rig hands the hull what it actually carries: the air's load on every particle, minus the inertia of its motion relative to the hull. A boom snatched up short by its sheet therefore hands its momentum to the hull.
- **Cost and levels.** On load, a short benchmark picks the level: L0, the full lattice (0.3–1.1 ms per step on one server core, against 0.07–0.15 ms for the strip model; `node test/bench.mjs`), L1, a coarser lattice and cloth, or the strip model. A governor steps the level down when the physics takes more than 6 ms of a frame. Time warp beyond ×2 uses the strip model.

### Rig dynamics
- **Booms** (main, and the Blackwatch's self-tacking staysail) are rotating bodies. They are driven by aerodynamic torque and gravity at heel, and stopped by the sheet. Gybes, crash-gybes, backwinding and the death roll all emerge from that, including the angular momentum the boom hands to the hull when it slams.
- **Loose headsails** have two sheets. The working sheet holds the clew until it is let fly (`F`). The lazy sheet, ground in on the windward winch (`J`), hauls the clew across and backs the jib (to heave to or get out of irons). When the clew crosses, the sheets swap roles. Automatic trim releases and re-tails the sheets in a tack. Every winch works: two-speed cranking (clockwise fast, anticlockwise powerful), and the handle moves to the winch you use. On the Blackwatch and the sportboat, a cabin-top winch takes any control led aft through the clutches. Each handle turn hauls a fixed length of line (about 19 cm in the fast gear, a third of that in the slow gear), and heavy loads stall the fast gear. Every line sits in a cam cleat, clutch or self-tailer. Released, a loaded line runs out by itself until you cleat it again.
- **Sheets** ease fast but trim slower under load. The rate depends on sheet tension against crew and winch power. The panel shows mainsheet, jib sheet and backstay loads in newtons, mast bend and headstay sag in millimetres.
- **The rudder** slews at a rate limited by its hydrodynamic load. A tiller you let go of trails toward the blade's zero-load angle, so a boat with weather helm rounds up.

### Foils and hull
- **Keel, daggerboard and rudder** are finite wings, with the Helmbold lift slope `2π/(2/AR + √(1+(2/AR)²))`, stall, post-stall flat-plate behaviour and induced drag. Each sees water-relative velocity, which includes wave orbital motion, yaw and roll rates, and the keel's downwash on the rudder. The rudder ventilates at extreme heel, which is how broaches happen. Raising the daggerboard cuts both area and aspect ratio.
- **Hull resistance** has three parts:
  - ITTC-57 friction.
  - Residuary (wave-making) resistance tabulated against Froude number for each hull. This gives the Blackwatch's hard wall at 5.6 kn and lets the dinghy and sportboat plane. The catamaran's slender hulls do not plane. Their table comes from towing-tank data for catamarans of the same slenderness (the Southampton series), and it stays at about 5% of the boat's weight past the hump. Flying a hull puts the whole weight on one hull and raises that figure by up to 30%.
  - Extra terms for heel drag, fore-aft trim, added resistance in waves, cross-flow drag, yaw damping and the heeled hull's asymmetry.
- **Stability** combines a GZ curve (weight and form terms) with crew weight at its real height. With the crew hiked and the boat heeled past about 50°, the crew adds to the capsizing moment instead of fighting it.

### Environment
- **Wind.** Puffs and lulls are noise in space and time: they are carried downwind at about the mean wind speed, stretched along it, and grow and die as they go, so the pattern never repeats. Puffs come down from aloft carrying a veered wind (backed south of the equator) and fan out as they land, lifting you on one edge and heading you on the other. Oscillating and spatial shifts are layered on top. Land upwind shelters the wind, which recovers over roughly a kilometre of open water.
- **Weather.** Steady, changing or squally. The gradient wind drifts in speed and direction over tens of minutes, and a sea breeze or land breeze builds and fades with the real sun at the venue. In squally weather a cumulonimbus cell comes through about every 11 minutes. Each one is born, towers up to an anvil, and dies over about 70 minutes while it tracks across with the wind aloft. Ahead of it the wind lulls into the updraft; under it the gust front hits, veered on one flank and backed on the other, with heavy rain that closes the visibility. Behind it the air is light and fitful. Mature cells throw lightning. Everything is a function of the seed and the clock, so everyone in a shared room gets the same squall at the same moment.
- **Waves.** A fetch-limited JONSWAP sea is grown from wind speed and the real upwind fetch to the coastline, and discretised into Gerstner components, with optional ocean swell. The GPU shader and the physics use the same components. Waves push the hull (Froude–Krylov surge force, so you surf), roll it, yaw it, and shrink in the lee and in shallow water.
- **Tide.** A current field is applied over ground. The instruments work like real ones: TWS and TWA are computed from the masthead unit and boat speed through the water.
- **Depth.** Estimated bathymetry shelves out from the real shoreline with shoals. Your keel or board can run aground.

### Velocity prediction
`solvePolar()` is a VPP that runs the full dynamic model at fixed true-wind angles with the automatic crew, and keeps the best of several trim targets. It drives the live polar, the POLAR % instrument and the AI's upwind and downwind angles.

Polars from `node test/vpp.mjs` in 12 kn of true wind (boat speed in knots, `g` = under gennaker or spinnaker):

| Boat | Upwind (TWA, speed, VMG) | 90° | 120° | 150° | Best downwind VMG |
|---|---|---|---|---|---|
| Blackwatch | 40°, 4.1, 3.1 | 5.2 | 5.0 | 4.4 | 3.9 at 165° |
| Sportboat | 40°, 6.1, 4.7 | 8.6 g | 10.2 g | 7.0 g | 6.2 at 165° |
| Dinghy | 36°, 4.4, 3.6 | 6.2 | 5.7 | 4.7 | 4.4 at 165° |
| Beach cat | 55°, 9.6, 5.5 | 13.3 g | 15.2 g | 7.6 g | 7.7 at 135° |

The cloth sails (`?sails=cloth`) are not yet calibrated to these numbers. The table below compares the same automatic crew at 120 Hz in 12 kn of true wind (best of three trim offsets, boat speed in knots). This is why the strip model remains the default:

| Boat | Upwind VMG, cloth / strip | 90° | 120° | 150° | Best downwind VMG |
|---|---|---|---|---|---|
| Blackwatch | 2.76 / 3.13 | 4.65 / 5.18 | 4.49 / 4.96 | 3.70 / 4.39 | 3.58 / 3.91 |
| Sportboat | 4.27 / 4.66 | 8.26 / 8.60 g | 7.61 / 10.15 g | 6.40 / 7.02 g | 5.64 / 6.26 |
| Dinghy | 3.38 / 3.54 | 6.43 / 6.19 | 5.73 / 5.74 | 4.57 / 4.68 | 4.32 / 4.39 |
| Beach cat | 4.51 / 5.45 | 13.22 / 13.35 g | 9.21 / 15.07 g | 6.07 / 7.64 g | 5.50 / 7.53 |

In 20 kn the sportboat planes at 16.4 kn at 120° under gennaker, and the cat reaches at 18.5–20 kn. The Blackwatch sails upwind with 6° of leeway (a long keel) and cannot pass its 5.6 kn hull speed. The cat's numbers are those of a 16 ft two-up beach cat such as a Hobie 16: about 5.5 kn VMG upwind and 13–15 kn reaching in 12 kn of wind. It used to show 11.2 kn upwind and 17.5 kn on a beam reach, because its residuary resistance was half the tank value and its slender hulls were treated as if they planed.

Helm balance (`node test/helm.mjs`) is the rudder angle that holds a steady course. With the Munk moment included, the keelboats are neutral upwind in 12 kn and carry 2–3° of weather helm in 20 kn, which is what designers aim for. Without it they had 3–5° of lee helm.

## What is approximated

These are the honest limits:

- **The cloth sails are a first version.** Under `?sails=cloth`, the sections still take their viscous lift and drag from the same empirical fitted polars. The lattice is potential flow, which is weakest in separated downwind flow, and flogging is forced rather than solved. The cunningham barely moves the draft, the jib car does not flatten the foot reliably, and the gennaker bags too deep. The resulting polars fall short of the strip model's, which is why the cloth model is not the default (see below).
- **Sail sections are empirical.** The coefficient curves are fitted functions of depth and draft, not a panel method or CFD. The three strips per sail capture twist and the wind gradient, not the full 3-D flow.
- **Depth is estimated.** It comes from distance to shore and the venue's typical depth, because OSM carries no bathymetry.
- **The hull model is simplified.** Heave and pitch follow the waves as a response model, not a full 6-DOF seakeeping solution. Slamming and green water are not modelled.
- **AI tactics are simple.** Crews use laylines, header tacks, starts and traffic avoidance. They do not apply the racing rules (right of way), and neither is a protest system.

## Controls

| Key | Action |
|---|---|
| `A` `D` / `←` `→` | Steer. The helm stays where you leave it; `Space` centres it. |
| `W` `S` | Mainsheet trim / ease |
| `↑` `↓` | Jib or gennaker sheet. Hold `Shift` for the staysail. |
| `F` | Let the jib sheet fly |
| `Z` `X` | Traveler |
| `C` `V` | Vang |
| `N` `M` | Backstay |
| `Q` `E` | Crew in / hike out |
| `J` / `Shift`+`J` | Haul / ease the lazy jib sheet to back the jib (una-rig: push the boom out) |
| `G` | Gennaker hoist / douse |
| `R` | Reef, or right a capsized dinghy |
| `Y` | Daggerboard |
| `T` `H` | Auto-trim / auto-hike |
| `1`–`7` | Cameras: chase, helm, bow, masthead, overhead, orbit, on deck |
| `L` `K` `I` | Laylines, force vectors, physics readout |
| `-` `=` | Time warp |
| `P` `Esc` | Pause, menu |
| `O` | Sound on / off |
| `?` | Help |

With the mouse, drag to look around and use the wheel to zoom; zooming all the way in puts you at the helm. Click the tactical map to drop a waypoint. On deck you can grab the lines themselves: pull ropes, slide cars along their tracks, wind winch handles round (clockwise is the fast gear), push the tiller, and click a cleat to release or cleat its line.

Every line is also in the rig panel as press-and-hold buttons, with a LOCK/FREE toggle for its cleat. Menu options include tiller steering (push the tiller and the bow goes the other way).

On a phone or tablet, drag to look around, pinch to zoom, and tap a rope, winch or cleat on deck to grab it. The touch pad holds the helm (◀ ▶ and Centre), the mainsheet and jib sheet, and one more line of the class (traveler, staysail, vang, crew weight, tack line, backstay or daggerboard): tap its name to pick the next. Auto trim and the gennaker hoist sit under it. The **Rig** button opens every line.

## Graphics

On a weak GPU, add `?q=low` to the URL. It lowers the render resolution, turns off shadows and uses a coarser sea mesh; the physics is unchanged.

## Running locally

```
python3 -m http.server 8000
# open http://localhost:8000
```

Development tools:

- `node test/vpp.mjs [class]` prints polars.
- `node test/race.mjs solent sportboat 6 25` runs a headless AI race on a real map.
- `node test/vlm.mjs`, `node test/cloth.mjs` and `node test/sailshape.mjs [class]` check the vortex lattice, the sailcloth and the cloth sails' shapes. `node test/bench.mjs [class]` times one physics step per sail model.
- `node tools/fetch-venues.mjs [id…]` re-bakes venues from OpenStreetMap.

## Credits and licences

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL. It is fetched through the Overpass API.
- Live weather is from [Open-Meteo](https://open-meteo.com).
- 3D rendering uses [three.js](https://threejs.org) (MIT). Peer-to-peer networking uses [Trystero](https://github.com/dmotz/trystero) (MIT).
- Blackwatch 19/24 specifications come from [sailboatdata.com](https://sailboatdata.com/sailboat/blackwatch-1924/), [sailboat.guide](https://sailboat.guide/blackwatch-19) and owner listings.
- The code is under the MIT licence (see `LICENSE`).
