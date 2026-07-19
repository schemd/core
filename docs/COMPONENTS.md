# Component and port reference

All listed directional families default to `orientation=right`. Indexed ports are one-based. Stable aliases retained from 0.2.x remain valid, but new integrations should use the names below.

## Electrical

| Kind | Variants/options | Stable ports |
| --- | --- | --- |
| `resistor` | `fixed`, `variable`, `rheostat`, `potentiometer`, `thermistor`, `ldr` | `in`, `out`; potentiometer adds `wiper` |
| `capacitor` | `fixed`, `variable`, `polarized` | `in`, `out` |
| `inductor` | `fixed`, `coupled`, `transformer` | `in`, `out`; coupled forms expose secondary terminals |
| `diode` | `standard`, `schottky`, `zener`, `led`, `photodiode`, `varactor`, `scr`, `triac` | `anode`, `cathode`; SCR adds `gate` |
| `transistor` | `npn`, `pnp`, `nmos`, `pmos`, `njfet`, `pjfet`, `nigbt`, `pigbt` | BJT: `base`, `collector`, `emitter`; FET/IGBT: `gate`, `drain`, `source` |
| `port` | `width=1..256` | `in`, `out` |
| `ground` | `style=signal|earth|chassis` | `in` |
| `source` | `voltage-dc`, `voltage-ac`, `voltage-pulse`, `current-dc`, `current-ac`, `battery`, `vcvs`, `vccs`, `ccvs`, `cccs` | `negative`, `positive`; dependent forms add `control-positive`, `control-negative` |
| `junction`, `testpoint` | no variants; no orientation | `node` |
| `connector` | no variants | `in`, `out` |
| `power` | `vcc`, `vdd`, `vss`, `positive`, `negative` | `in` |
| `switch` | `spst`, `spdt`, `pushbutton`, `relay` | SPST/pushbutton: `in`, `out`; SPDT: `common`, `normally-open`, `normally-closed`; relay also exposes `coil1`, `coil2` |
| `protection` | `fuse`, `breaker` | `in`, `out` |
| `amplifier` | `opamp`, `comparator`, `instrumentation` | `positive`, `negative`, `out`, `v+`, `v-` |
| `resonator` | `crystal`, `ceramic` | `in`, `out` |
| `meter` | `voltmeter`, `ammeter` | `in`, `out` |
| `load` | `lamp`, `motor`, `speaker`, `buzzer` | `in`, `out` |
| `ic` | `left`, `right`, `top`, `bottom` pin lists | each declared pin name |

## Digital

Classical gates are `and`, `or`, `not`, `nand`, `nor`, `xor`, and `xnor`. They accept `inputs=1..32`, `outputs=1..32`, and `standard=ieee|iec`; ports are `in1..inN` and `out1..outN`.

| Kind | Variants/options | Stable ports |
| --- | --- | --- |
| `buffer` | `plain`, `tristate`, `tristate-inverter`, `schmitt`, `schmitt-inverter` | `in1`, `out1`; tri-state adds `enable` |
| `logic` | `high`, `low`, `unknown`, `high-z` | `out` |
| `clock` | — | `out` |
| `flipflop` | `sr-latch`, `d-latch`, `d`, `jk`, `t` | type inputs plus `clock`, `enable`, `preset`, `clear`, `q`, `nq` |
| `mux` | `mux`, `demux`; bounded `inputs`, `outputs` | indexed data ports, `select`, `enable` |
| `encoder`, `decoder` | bounded `inputs`, `outputs` | indexed inputs and outputs |
| `register` | `width=2..256` | `in`, `out`, `clock`, `enable`, `clear` |
| `counter` | bounded outputs | `clock`, `enable`, `clear`, indexed outputs |
| `adder` | `half`, `full` | indexed inputs and outputs |
| `comparator` | — | `in1`, `in2`, `gt`, `eq`, `lt` |
| `bus` | `tap`, `splitter`, `joiner`; `width=2..256` | `bus`, `tap`, or indexed branches |

## Quantum

`hadamard`, `qgate`, `xgate`, `ygate`, `zgate`, `sgate`, `sdg`, `tgate`, `tdg`, `sx`, `phase`, `rx`, `ry`, `rz`, and `ugate` use `in`/`out`. Named/parameterized gates accept the applicable `parameter`; `qgate` also accepts `matrix` and `phase`.

| Kind | Options | Stable ports |
| --- | --- | --- |
| `measure` | — | `in`, `out`, `classical` |
| `reset` | — | `in`, `out` |
| `prepare` | — | `out` |
| `control` | `control=positive|negative|classical` | `in`, `out`, `control` |
| `swap`, `cz`, `cphase`, `toffoli`, `controlled` | bounded `controls`, `targets`; `controlled` adds `operator` | indexed `inN`, `outN`, `controlN`, `targetN` as applicable |
| `barrier`, `delay` | bounded `wires` | indexed `inN`, `outN` |
| `classical-bit` | — | `in`, `out` |
| `classical-register` | `width=2..256` | `in`, `out` |

## UML

- Structural/deployment: `class`, `interface`, `provided-interface`, `required-interface`, `enumeration`, `datatype`, `object`, `component`, `component-port`, `artifact`, `node`, `device`, `execution`, `system`, `package`, `note`.
- Activity: `actor`, `usecase`, `action`, `decision`, `merge`, `fork`, `join`, `activity-final`, `flow-final`, `object-node`, `send-signal`, `receive-signal`, `partition`.
- Interaction: `lifeline`, `activation`, `destruction`, `fragment`, `interaction`, `gate`, `found`, `lost`.
- State machine: `state`, `choice`, `state-junction`, `history` (`type=shallow|deep`), `entry`, `exit`, `terminate`, `region`, `initial`, `final`.

Class-like nodes accept bounded `attributes`, `operations`, `stereotype`, and `width`. States accept bounded `details` and `width`. Sized boxes accept bounded `width`/`height`. Box-like UML nodes expose `left`, `right`, `top`, and `bottom`; pseudostates expose only meaningful boundary ports.
