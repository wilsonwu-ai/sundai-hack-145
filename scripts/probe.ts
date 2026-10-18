import { solve } from '../src/engine/solver'
import { defaultLayout } from '../src/engine/presets'
import { wireLength, WIRE_BUDGET } from '../src/engine/constraints'
console.log('default WL', wireLength(defaultLayout()).toFixed(1), 'budget', WIRE_BUDGET.toFixed(1))
// crude spread: compute dies pushed apart diagonally by s mm
for (const s of [0, 3, 6, 9]) { const l = defaultLayout(); const d=[[-1,-1],[1,-1],[-1,1],[1,1]]; l.chiplets.slice(0,4).forEach((c,k)=>{c.x+=d[k][0]*s;c.y+=d[k][1]*s}); console.log('spread', s, solve(l).tMax.toFixed(2), 'WL', wireLength(l).toFixed(1)) }
