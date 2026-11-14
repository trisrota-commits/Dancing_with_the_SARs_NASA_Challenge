// Small text labels pinned to places on the globe: plain HTML laid over the
// canvas and moved each frame. They carry data (a magnitude, a shaking
// level, a wind speed), never decoration, and there are only ever a few.

export class Labels {
  constructor(container) {
    this.box = document.createElement('div');
    this.box.className = 'glabels';
    container.appendChild(this.box);
    this.items = [];
    this.nodes = [];
  }

  // items: [{ lat, lon, text, color, within }]. `within` is the camera
  // distance (in Earth radii) inside which the label shows; leave it out
  // for a label that always shows.
  set(items) {
    this.items = items;
    while (this.nodes.length > items.length) this.nodes.pop().remove();
    items.forEach((it, i) => {
      let node = this.nodes[i];
      if (!node) {
        node = document.createElement('span');
        this.box.appendChild(node);
        this.nodes.push(node);
      }
      if (node.textContent !== it.text) node.textContent = it.text;
      node.style.setProperty('--c', it.color || '#e8edf5');
    });
  }

  // place(lat, lon) gives the screen position or null when hidden; distance
  // is how far the camera is from what it looks at.
  update(place, distance) {
    this.items.forEach((it, i) => {
      const node = this.nodes[i];
      const at = it.within == null || distance <= it.within ? place(it.lat, it.lon) : null;
      node.style.opacity = at ? 1 : 0;
      if (at) node.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -150%)`;
    });
  }
}
