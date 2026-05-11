# @creadev.org/escrow

> Escrow - quotas, rate limiting

[![npm](https://img.shields.io/npm/v/@creadev.org/escrow)](https://www.npmjs.com/package/@creadev.org/escrow)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Install

```bash
npm install @creadev.org/escrow
```

## Usage

```typescript
import { Escrow, createEscrow, checkQuota, reserve, release } from '@creadev.org/escrow';

const escrow = createEscrow({ quota: 100 });
const canProceed = await checkQuota('user-id');
await reserve('user-id', 10);
await release('user-id', 5);
```

## API

| Function | Description |
|----------|-------------|
| `createEscrow(options?)` | Create escrow |
| `checkQuota(id)` | Check quota |
| `reserve(id, amount)` | Reserve quota |
| `release(id, amount)` | Release quota |

## License

MIT
trigger
