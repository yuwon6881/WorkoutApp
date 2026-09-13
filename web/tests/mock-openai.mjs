// A stand-in for the OpenAI Responses endpoint used only by the end-to-end run. It answers with a
// fixed two-week program so the upload, review, edit, and accept path can be exercised without
// spending a real call or depending on model wording.
import { createServer } from 'node:http';

const program = {
  programName: 'Imported strength block',
  description: 'A two-week block read from the uploaded PDF.',
  weeks: [
    {
      week: 1,
      workouts: [{
        name: 'Week 1 Upper', focus: 'Push and pull', notes: null,
        exercises: [
          {
            sourceName: 'Barbell bench press', exerciseId: null, notes: null,
            sets: [
              { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 120, tempo: null, loadText: null, notes: null, repsSource: 'extracted', rpeSource: 'inferred', restSource: 'extracted' },
              { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 120, tempo: null, loadText: null, notes: null, repsSource: 'extracted', rpeSource: 'inferred', restSource: 'extracted' }
            ]
          },
          {
            sourceName: 'Mystery machine row', exerciseId: null, notes: 'Not named in the library.',
            sets: [{ repMin: 12, repMax: 12, targetRpe: 7, restSeconds: 90, tempo: null, loadText: null, notes: null, repsSource: 'extracted', rpeSource: 'extracted', restSource: 'inferred' }]
          }
        ]
      }]
    },
    {
      week: 2,
      workouts: [{
        name: 'Week 2 Upper', focus: 'Push and pull', notes: null,
        exercises: [{
          sourceName: 'Barbell bench press', exerciseId: null, notes: null,
          sets: [{ repMin: 6, repMax: 8, targetRpe: 9, restSeconds: 180, tempo: null, loadText: '80% 1RM', notes: null, repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted' }]
        }]
      }]
    }
  ]
};

createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      status: 'completed',
      usage: { input_tokens: 1200, output_tokens: 400 },
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(program) }] }]
    }));
  });
}).listen(5184, '127.0.0.1', () => console.log('mock openai listening on 5184'));
