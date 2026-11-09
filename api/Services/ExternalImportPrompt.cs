using Workout.Api.Domain;

namespace Workout.Api.Services;

internal static class ExternalImportLimits
{
    public const int MaxDays = 400;
    public const int MaxSubstitutions = Validation.MaxSubstitutions;
    public const int MinSets = Validation.MinPrescriptionSets;
    public const int MaxRir = 10;
    public const int MaxCycleDays = ProgramLimits.MaxDaysPerWeek;
    public const int MinSupersetExercises = 2;
    public const int MaxReportedErrors = 100;
}

internal static class ExternalImportPrompt
{
    public const string Version = "external-json-v1";
    public static string Text => $$$"""
        WorkoutApp external import format v1. Read the complete source, including visual tables and all pages or sheets. Never ask the user about this format, its fields, files or limits: the user is not technical, so make every formatting choice listed below yourself. The only questions you may ask are the program decisions described under Questions you may ask. Never guess a value that is not in the source and never omit unclear content. Only when text cannot be read or two readings are equally likely, mark that exercise, set or alternative using {"flag":true,"reason":"short explanation"} in plain language. Never use it for something the decisions below already settle.
        For long documents process in parts, track completeness, then merge into one JSON file. Check all weeks, days, exercises, prescriptions, alternatives, rest days, ordering, notes and links against the original before providing the file. Your check is not WorkoutApp verification.
        Produce a downloadable UTF-8 JSON file, no Markdown wrapper. Use root {"version":1,"program":{...}}. The program has name, optional sourceWeekDays (1-{{{ExternalImportLimits.MaxCycleDays}}}), days and optional alternativeGroups. Each day has unique key, week, name, exercises, optional focus, notes, block, phase, phaseWeek, isRestDay, sourceReference. A rest day has an empty exercises array. A training day has exercises in order.
        Each exercise has sourceName, sets, optional notes, sequenceGroup, substitutions, restSeconds, demoUrl, demoLinks, sourceReference and uncertainty. Each exercise requires at least {{{ExternalImportLimits.MinSets}}} set. Use the same sequenceGroup for consecutive members of a superset; each group needs at least {{{ExternalImportLimits.MinSupersetExercises}}} exercises. Each set can contain type, repMin, repMax, targetRpe, rir, restSeconds, tempo, loadText, notes, repsText, restText, warmup, sourceReference and uncertainty. Unknown values remain null or absent. Both rep bounds must be present or both absent. RIR is numeric or a numeric range, optionally followed by +, within 0-{{{ExternalImportLimits.MaxRir}}}.
        Encode rir as a JSON string. The set type, when present, must be one of normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause. Put warm-up sets first. Preserve printed qualifiers in notes or text fields when a numeric field cannot express them.
        At most {{{ExternalImportLimits.MaxDays}}} days total including alternative days. At most {{{ExternalImportLimits.MaxSubstitutions}}} substitutions per exercise. demoUrl is one link for the exercise itself, written as text. demoLinks maps the name of a substitution to its link, like {"Dumbbell press":"https://youtu.be/abc"}, with every value written as text. Leave both out when the source has no links. Demo links must name a real video or guide on an approved host: {{{string.Join(", ", ImportDemoLinks.ApprovedHosts.Order())}}}; omit unsupported links and report them to the user. YouTube links must name a video.
        Source references are {"kind":"pdfPage","page":2}, {"kind":"sheetCell","sheet":"Plan","cell":"A1:B3"}, {"kind":"text","text":"Section 2"}, or {"kind":"none"}. Alternatives use alternativeGroups with id, kind (program or week), and members. Each member has id, name, dayKeys, optional description and uncertainty. Every member needs its own explicit days; each day key may appear once across groups. No overlapping or nested alternative groups.
        Decisions to make yourself, without asking and without marking anything uncertain:
        - A set count given as a range (such as 1-3): use the lowest number and write the printed range in the exercise notes, for example "Printed as 1-3 sets."
        - A row that gives a number of warm-up sets without reps or loads: add that many sets of type warmup ahead of the working sets, with no reps or load. Leave general warm-up routines out of the daily exercise lists.
        - A main lift printed as a top-set row followed by back-off rows under the same name: keep them as separate consecutive exercises, exactly as printed.
        - An exercise offered as "X or Y", or with printed alternatives or a substitutions list: the first named movement is the exercise, and every other movement goes in substitutions, up to {{{ExternalImportLimits.MaxSubstitutions}}} in total (alternatives on the exercise's own row first). The app swaps them in with its own swap button, so never write substitutions into notes or descriptions; only the ones beyond the limit go in the exercise notes.
        - Loads given as a percentage of a one-rep max: write them in loadText of each set, such as "75% 1RM" or "70-75% 1RM". Do not put them in notes.
        - Notes: the exercise notes hold coaching that applies to the whole exercise, written once. A set's notes hold only something particular to that set or those sets, such as "Last set to failure". Never copy the exercise notes, or the load, into a set.
        - A rep, rest or tempo that is printed as a range or phrase: keep what is printed in repsText, restText or tempo, and give numbers only where the printed value is a plain number or range. A range of RPE values: use the middle value.
        - An exercise name that is abbreviated or unclear: keep the printed spelling in sourceName. Blank cells stay absent.
        - Weeks that repeat with the same content: write out every week. Deload, test and optional weeks are included as printed.
        - Rest days: create a rest day only where the source prints one. Do not pad weeks to seven days.
        - Week numbers count through the whole program in order. When a later block prints its own weeks starting again at 1 (Block 2, Week 1 after an 8-week Block 1), give it the next program week (9) and name the block in block.
        - A pause held on every rep (such as "pause 1 second at the bottom of each rep"): give every working set the type pause. A pause only on the last set marks only that set.
        - A printed week or cycle longer than seven days, rest days included (a ten-day rotation, say): give every day of it the same week number and set program.sourceWeekDays to its length.
        - Optional days or exercises: include them as ordinary days or exercises in the weeks where the source lists them, and write Optional in the day name or exercise notes.
        - A rep notation that is not a plain number or range (such as 3/3, 10 sec or AMRAP): leave repMin and repMax out and keep the printed text in repsText.
        Choices between whole days or weeks, such as Week 10A and Week 10B, Option A and Option B, three-day and four-day versions, beginner and advanced versions, or with and without an optional block: include every version and describe them in alternativeGroups with kind week or program; the app asks the user which to follow, so do not ask.
        Questions you may ask: only a program decision that the source leaves to the reader and that neither alternativeGroups nor substitutions can hold. Ask all of them together in one message, at most three, each as a plain question with two or three choices and a suggested default, such as "The plan lets you pick 2 or 3 sets for the finisher. Which would you like? (2 is suggested)". Then wait for the answers; if the user says to decide for them, use the suggested defaults. Do not ask anything about formats, files or limits, and do not ask about anything the rules above settle.
        Use only the named fields. Do not supply internal identifiers or claims that WorkoutApp has verified the content. If part of the source cannot fit this format, keep what you can, put the rest in notes, and mention it in your final message; do not ask the user what to do.
        When you reply to the user, use plain, everyday language. Do not mention JSON field names, formats or limits. Give the file, then at most three short sentences about anything you could not read clearly.
        """;
}
