# True Wind

A browser sailing simulator where the boat is not animated — it is computed. Every frame, the wind on each strip of each sail, the shape your strings give that sail, the lift of the keel and rudder, the resistance of the hull, the heel, the waves and the tide are solved as forces and moments on a rigid body, 120 times a second.

**Play:** https://hclivess.github.io/truewind/

It runs in any modern browser with WebGL, with no install and no build step.

## What you can sail

| Boat | What it is |
|---|---|
| **Blackwatch 19/24** | Dave Autry's 1979 pocket bluewater cutter from Blue Water Boatworks (81 built, 1979–81). LOA 5.64 m (nearly 24 ft with the bowsprit), LWL 5.33 m, beam 2.29 m, draft 0.61 m, 1,021 kg with 363 kg of iron ballast, 19.7 m² of sail. Long keel, transom-hung rudder, teak bowsprit, self-tacking staysail, flying jib, double-reefed main. Its home port in the sim is **Progreso, Yucatán**. |
| **Sportboat 23** | A 7 m one-design keelboat with four crew, a carbon mast and an asymmetric gennaker. It planes downwind from about 13 kn of wind. |
| **Singlehander 14** | A 4.2 m una-rig Olympic-style dinghy with one sailor, a bendy unstayed mast and a daggerboard. It capsizes. |

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
`(m+mₓ)(u̇ − v r·m_y/m_x) = X`, `(m+m_y)(v̇ + u r·m_x/m_y) = Y`, `I_z ṙ = N`, `I_x ṗ = K`.
Heave and pitch respond as damped oscillators to the wave elevation along the hull. The response includes bow-down trim from sail drive, squat, crew fore-aft trim, and the bow lifting as the boat starts to plane.

### Sails: strip theory with shape
Each sail is split into three horizontal strips. For each strip, per step:

1. **Apparent wind.** The true wind comes from a neutral log boundary layer, `U(h) = U₁₀ ln(h/z₀)/ln(10/z₀)`, with z₀ taken from Charnock roughness. The strip's own velocity is subtracted from it: surge, sway, yaw rate × lever arm, roll rate × height, and the boom's swing. The result is projected into the heeled rig plane (the cos φ effective-angle correction).
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

### Rig dynamics
- **Booms** (main, and the Blackwatch's self-tacking staysail) are rotating bodies. They are driven by aerodynamic torque and gravity at heel, and stopped by the sheet. Gybes, crash-gybes, backwinding and the death roll all emerge from that, including the angular momentum the boom hands to the hull when it slams.
- **Loose headsails** have two sheets. The working sheet holds the clew until it is let fly (`F`). The lazy sheet, ground in on the windward winch (`J`), hauls the clew across and backs the jib (to heave to or get out of irons). When the clew crosses, the sheets swap roles. Automatic trim releases and re-tails the sheets in a tack. Every winch works: two-speed cranking (clockwise fast, anticlockwise powerful), and the handle moves to the winch you use. On the Blackwatch and the sportboat, a cabin-top winch takes any control led aft through the clutches.
- **Sheets** ease fast but trim slower under load. The rate depends on sheet tension against crew and winch power. The panel shows mainsheet, jib sheet and backstay loads in newtons, mast bend and headstay sag in millimetres.
- **The rudder** slews at a rate limited by its hydrodynamic load. A tiller you let go of trails toward the blade's zero-load angle, so a boat with weather helm rounds up.

### Foils and hull
- **Keel, daggerboard and rudder** are finite wings, with the Helmbold lift slope `2π/(2/AR + √(1+(2/AR)²))`, stall, post-stall flat-plate behaviour and induced drag. Each sees water-relative velocity, which includes wave orbital motion, yaw and roll rates, and the keel's downwash on the rudder. The rudder ventilates at extreme heel, which is how broaches happen. Raising the daggerboard cuts both area and aspect ratio.
- **Hull resistance** has three parts:
  - ITTC-57 friction.
  - Residuary (wave-making) resistance tabulated against Froude number for each hull. This gives the Blackwatch's hard wall at 5.6 kn and lets the dinghy and sportboat plane.
  - Extra terms for heel drag, fore-aft trim, added resistance in waves, cross-flow drag, yaw damping and the heeled hull's asymmetry.
- **Stability** combines a GZ curve (weight and form terms) with crew weight at its real height. With the crew hiked and the boat heeled past about 50°, the crew adds to the capsizing moment instead of fighting it.

### Environment
- **Wind.** Puffs and lulls are advected at the mean wind speed and elongated along it. Puffs tend to veer. Oscillating and spatial shifts are layered on top. Land upwind shelters the wind, which recovers over roughly a kilometre of open water.
- **Waves.** A fetch-limited JONSWAP sea is grown from wind speed and the real upwind fetch to the coastline, and discretised into Gerstner components, with optional ocean swell. The GPU shader and the physics use the same components. Waves push the hull (Froude–Krylov surge force, so you surf), roll it, yaw it, and shrink in the lee and in shallow water.
- **Tide.** A current field is applied over ground. The instruments work like real ones: TWS and TWA are computed from the masthead unit and boat speed through the water.
- **Depth.** Estimated bathymetry shelves out from the real shoreline with shoals. Your keel or board can run aground.

### Velocity prediction
`solvePolar()` is a VPP that runs the full dynamic model at fixed true-wind angles with the automatic crew, and keeps the best of several trim targets. It drives the live polar, the POLAR % instrument and the AI's upwind and downwind angles.

Calibration against real one-design polars in 12 kn of true wind:

- **Sportboat:** about 5.5 kn upwind and 7.9 kn reaching under gennaker. In 20 kn it planes at about 15 kn.
- **Dinghy:** about 4.6 kn upwind and 6.2 kn on a beam reach.
- **Blackwatch:** about 4.2 kn upwind at 44° with 6–7° of leeway (a long keel). It reaches at about 5.1 kn and cannot pass its 5.6 kn hull speed.

## What is approximated

These are the honest limits:

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
| `Z` `X` | Traveler |
| `C` `V` | Vang |
| `N` `M` | Backstay |
| `Q` `E` | Crew in / hike out |
| `J` (hold) | Back the jib |
| `G` | Gennaker hoist / douse |
| `R` | Reef, or right a capsized dinghy |
| `Y` | Daggerboard |
| `T` `H` | Auto-trim / auto-hike |
| `1`–`6` | Cameras: chase, helm, bow, masthead, overhead, orbit |
| `L` `K` `I` | Laylines, force vectors, physics readout |
| `-` `=` | Time warp |
| `P` `Esc` | Pause, menu |

All other controls (cunningham, outhaul, jib car and halyard, tack line, crew fore-aft) are sliders in the rig panel. Menu options include tiller steering (push the tiller and the bow goes the other way).

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
- `node tools/fetch-venues.mjs [id…]` re-bakes venues from OpenStreetMap.

## Credits and licences

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL. It is fetched through the Overpass API.
- Live weather is from [Open-Meteo](https://open-meteo.com).
- 3D rendering uses [three.js](https://threejs.org) (MIT). Peer-to-peer networking uses [Trystero](https://github.com/dmotz/trystero) (MIT).
- Blackwatch 19/24 specifications come from [sailboatdata.com](https://sailboatdata.com/sailboat/blackwatch-1924/), [sailboat.guide](https://sailboat.guide/blackwatch-19) and owner listings.
- The code is under the MIT licence (see `LICENSE`).
