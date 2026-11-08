# External import accuracy harness

Compares two ways of turning the same program document into a reviewable draft, scored against a
file a person checked by hand:

- **Old PDF importer**: the draft the app produced from the PDF.
- **ChatGPT JSON**: the file ChatGPT produced from the app's prompt, run through the real converter.

**There is no accuracy conclusion until you run this on real files.** The tests under
`tests/ImportAccuracyScorerTests.cs` only prove the scorer counts known differences correctly. Nothing in
this folder was measured on a real document, and a perfect score on a synthetic file means nothing.

## Add cases

Pick 5-10 real programs the importer matters for: PDFs and Excel files, including scanned and visually
complex ones, and at least one with alternatives or supersets. Make one folder per document under a
folder **outside the repository** (documents are not committed):

```text
<cases>/
  <program-name>/
    gold.json              required: hand-checked, external v1 format
    chatgpt.json           ChatGPT's output for the same document (external v1 format)
    legacy-draft.json      the old importer's draft for the same PDF
    selection.txt          required only when gold.json offers alternatives: the option(s) to score, one name per line
    unrepresentable.txt    optional: things in the document the v1 format cannot express
```

At least one of `chatgpt.json` and `legacy-draft.json` is required per case. Both gives a side-by-side
comparison, which is the point.

### Writing `gold.json`

Read the original document, not either importer's output, and write the program in the v1 format
(`docs/EXTERNAL_IMPORT_V1.md`). The harness converts it with the same converter as the candidate, so a
gold file the converter rejects is reported as a problem with the gold, not a score.

- Use the exercise names exactly as the document prints them. Names are compared ignoring case, spacing
  and punctuation, but not synonyms: "DB Bench" and "Dumbbell bench press" differ and cost two corrections
  (one missing, one extra).
- Leave a value out when the document does not state it. An unstated value never matches a stated one.
- Do not copy from `chatgpt.json` or `legacy-draft.json`; that biases the result toward the copied one.

### Programs with alternatives

The old importer's draft only holds the option that was chosen, while a gold or ChatGPT file lists every
option. So each side is scored after the same option is chosen: name it in `selection.txt` (matched ignoring
case and punctuation) and import the old draft with that same option selected. A ChatGPT file that does not
offer the named option is reported as rejected with that reason. Whether the options themselves were offered
correctly is scored only for the ChatGPT file, because the old importer's draft no longer holds the others; the
report says so rather than counting them as missing.

### Getting `chatgpt.json`

Use the app's **Import with ChatGPT** panel: copy the prompt, give ChatGPT the document, save the JSON
it returns without editing it. If the first file is rejected, the ChatGPT result for scoring is still the
first file; record how many rounds of "Copy errors for ChatGPT" it took in `unrepresentable.txt` or your
own notes. A file the validator rejects appears in the report as **rejected** with its reason.

### Getting `legacy-draft.json`

Import the same PDF with the old reader and, before accepting, open the app signed in, then in the browser
console run (replace the id with the import's id from the page URL or network tab):

```js
fetch('/api/imports/<import id>', { headers: { 'X-Workout-Request': '1' }, credentials: 'same-origin' })
  .then(r => r.text()).then(t => copy(t))
```

Paste the clipboard into `legacy-draft.json`. Either the whole response or just its `draft` is accepted.
Export it before making any edits in review, so the file reflects the reader and not the reviewer.

## Run

From the repository root (PowerShell):

```powershell
$env:WORKOUT_ACCURACY_CASES = 'D:\path\to\cases'
$env:WORKOUT_ACCURACY_OUT = 'D:\path\to\report'   # optional; defaults to <cases>\report
dotnet test tests/Workout.Tests.csproj --filter FullyQualifiedName~ExternalImportAccuracyReport
```

Without `WORKOUT_ACCURACY_CASES` the test does nothing. With it, a missing or unreadable input fails the
run with the case name, so an incomplete corpus cannot produce a flattering report.

## Output

`report.md` and `report.json` list, per case and for the old and new paths side by side:

- **Field accuracy**: matched gold fields over every gold field. An omitted day or exercise counts all of
  its fields as missed.
- **Corrections needed**: a proxy for review effort. One per added or removed day, exercise or set, and
  one per wrong field. An invented day is one correction however many exercises it holds; a missing day
  is one plus one per exercise in it. It is not measured editing time.
- Days, exercises and sets missing or extra; per-field rates; and every individual difference.
- **Rejected** files (no draft, no score) with the validator's path and message.
- Your `unrepresentable.txt`, so capabilities the external workflow cannot reproduce are listed with the
  numbers instead of hidden.

## How things are matched

Days and exercises are aligned by longest common subsequence on normalised names (week plus day name for
days). One omitted or invented row therefore does not turn every following row into a mismatch, but a
renamed day or exercise counts as one missing and one extra. Sets are compared by position within a matched
exercise. Supersets compare the partners an exercise has, not the group label. Substitutions and links
compare as sets. Alternative members match on name and day count.

Not scored: demonstration-link quality, catalogue matching of exercise names, and review-screen usability.
A lower correction count does not show the draft is correct where gold itself is wrong.

## Reading the result

Compare the two columns only on the same files. Report rejected files and the "not representable" notes
with any claim you make, and do not retire the PDF importer on a headline percentage: look at which fields
and which kinds of documents each path gets wrong.
