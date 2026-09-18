// A stand-in for the OpenAI Responses endpoint used only by the end-to-end run. It answers the
// outline pass and then two content passes so the browser exercises resumable chunked imports
// without spending a real call or depending on model wording.
import { createServer } from 'node:http';

const outline = {
  programTitle: 'Imported strength block',
  chunks: [
    { label: 'Block 1 · Base · Week 1', block: 'Block 1', phase: 'Base', weekFrom: 1, weekTo: 1, pageFrom: 1, pageTo: 2, dayCount: 1 },
    { label: 'Block 1 · Base · Week 2', block: 'Block 1', phase: 'Base', weekFrom: 2, weekTo: 2, pageFrom: 3, pageTo: 4, dayCount: 2 }
  ]
};

const chunks = [
  {
    programTitle: 'Imported strength block',
    days: [{
      block: 'Block 1', phase: 'Base', weekNumber: 1, phaseWeek: 1, dayName: 'Week 1 Upper', isRestDay: false, notes: null,
      exercises: [
        {
          sequenceGroup: 'A1', sourceName: 'Barbell bench press', exerciseId: null, warmupSets: '2-3', substitutions: ['Incline dumbbell press', 'Push-up'],
          coachingNotes: null, notes: null,
          sets: [
            { repMin: 8, repMax: 10, repsText: '8–10', targetRpe: 8, rir: null, restSeconds: 120, restText: '2 min', tempo: null, loadText: null, notes: null, repsSource: 'extracted', rpeSource: 'inferred', restSource: 'extracted' },
            { repMin: 8, repMax: 10, repsText: '8–10', targetRpe: 8, rir: null, restSeconds: 120, restText: '2 min', tempo: null, loadText: null, notes: null, repsSource: 'extracted', rpeSource: 'inferred', restSource: 'extracted' }
          ]
        },
        {
          sequenceGroup: 'A2', sourceName: 'Mystery machine row', exerciseId: null, warmupSets: null, substitutions: [],
          coachingNotes: 'Keep the chest supported.', notes: 'Not named in the library.',
          sets: [{ repMin: 12, repMax: 12, repsText: 'AMRAP', targetRpe: 7, rir: '3', restSeconds: 90, restText: '90 sec', tempo: null, loadText: null, notes: null, repsSource: 'extracted', rpeSource: 'extracted', restSource: 'inferred' }]
        }
      ]
    }]
  },
  {
      programTitle: 'Imported strength block',
    days: [
      {
        block: 'Block 1', phase: 'Base', weekNumber: 2, phaseWeek: 2, dayName: 'Week 2 Upper', isRestDay: false, notes: null,
        exercises: [{
          sequenceGroup: 'B1', sourceName: 'Barbell bench press', exerciseId: null, warmupSets: null, substitutions: [], coachingNotes: null, notes: null,
          sets: [{ repMin: 6, repMax: 8, repsText: '6–8', targetRpe: 9, rir: null, restSeconds: 180, restText: '3 min', tempo: null, loadText: null, notes: null, repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted' }]
        }]
      },
      { block: 'Block 1', phase: 'Base', weekNumber: 2, phaseWeek: 2, dayName: 'Week 2 Recovery', isRestDay: true, notes: 'Recover before the next block.', exercises: [] }
    ]
  }
];

let chunkIndex = 0;

function response(payload) {
  return {
    status: 'completed',
    usage: { input_tokens: 1200, output_tokens: 400 },
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(payload) }] }]
  };
}

createServer((request, responseStream) => {
  if (request.method !== 'POST') {
    responseStream.writeHead(200, { 'Content-Type': 'text/plain' });
    responseStream.end('ok');
    return;
  }
  let body = '';
  request.on('data', piece => { body += piece; });
  request.on('end', () => {
    let requestBody = {};
    try { requestBody = JSON.parse(body); } catch { /* the API under test will report malformed output */ }
    const schemaName = requestBody.text?.format?.name;
    if (schemaName === 'training_program_outline') chunkIndex = 0;
    const payload = schemaName === 'training_program_outline' ? outline : chunks[chunkIndex++] ?? chunks.at(-1);
    responseStream.writeHead(200, { 'Content-Type': 'application/json' });
    responseStream.end(JSON.stringify(response(payload)));
  });
}).listen(5184, '127.0.0.1', () => console.log('mock openai listening on 5184'));
