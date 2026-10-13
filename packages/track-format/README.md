# @tinylap/track-format

Read, validate and draw track layouts for the Kyosho Mini-Z Grand Prix Circuit 30: the layout data model, piece geometry, barrier and lap metrics, and SVG rendering.
It is plain ES modules with TypeScript declarations, and runs in browsers and Node.

## Install

```sh
npm install @tinylap/track-format
```

## Usage

```js
import { layoutFromData, isClosedCircuit, computeMetrics, layoutToSvgString } from '@tinylap/track-format';

const layout = layoutFromData(JSON.parse(saved)); // throws on an unknown version or piece
console.log(isClosedCircuit(layout), computeMetrics(layout).lapMm);
const svg = layoutToSvgString(layout, { theme: 'light' });
```

The data model types are exported too: `import type { Layout } from '@tinylap/track-format'`.

## License

MPL-2.0. See `LICENSE`.
