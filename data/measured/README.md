# Calibrated NISAR measurements

This folder is filled by `tools/measure.py`. Each measured site gets:

- `<site>.json`: the HH and HV time series in dB, the change-map dates,
  a one-sentence summary and the method;
- `<site>_change.png`: the change map;
- `index.json`: the list of measured sites, which the app reads.

The app shows a "Measured with NISAR" card on a place, or on an event
nearby, as soon as its files are here. Until then nothing is shown.

To make them, see "Measuring with NISAR" in the main README.
