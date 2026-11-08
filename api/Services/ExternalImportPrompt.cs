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
        WorkoutApp external import format v1. Read the complete source, including visual tables and all pages or sheets. Do not ask the user any questions: the user is not technical and cannot answer questions about this format, so make the choices listed below yourself. Never guess a value that is not in the source and never omit unclear content. Mark uncertain exercise, set, and alternative details using {"flag":true,"reason":"short explanation"}. Write each uncertainty reason in plain language.
        For long documents process in parts, track completeness, then merge into one JSON file. Check all weeks, days, exercises, prescriptions, alternatives, rest days, ordering, notes and links against the original before providing the file. Your check is not WorkoutApp verification.
        Produce a downloadable UTF-8 JSON file, no Markdown wrapper. Use root {"version":1,"program":{...}}. The program has name, optional sourceWeekDays (1-{{{ExternalImportLimits.MaxCycleDays}}}), days and optional alternativeGroups. Each day has unique key, week, name, exercises, optional focus, notes, block, phase, phaseWeek, isRestDay, sourceReference. A rest day has an empty exercises array. A training day has exercises in order.
        Each exercise has sourceName, sets, optional notes, sequenceGroup, substitutions, restSeconds, demoUrl, demoLinks, sourceReference and uncertainty. Each exercise requires at least {{{ExternalImportLimits.MinSets}}} set. Use the same sequenceGroup for consecutive members of a superset; each group needs at least {{{ExternalImportLimits.MinSupersetExercises}}} exercises. Each set can contain type, repMin, repMax, targetRpe, rir, restSeconds, tempo, loadText, notes, repsText, restText, warmup, sourceReference and uncertainty. Unknown values remain null or absent. Both rep bounds must be present or both absent. RIR is numeric or a numeric range, optionally followed by +, within 0-{{{ExternalImportLimits.MaxRir}}}.
        Encode rir as a JSON string. The set type, when present, must be one of normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause. Put warm-up sets first. Preserve printed qualifiers in notes or text fields when a numeric field cannot express them.
        At most {{{ExternalImportLimits.MaxDays}}} days total including alternative days. At most {{{ExternalImportLimits.MaxSubstitutions}}} substitutions per exercise. demoUrl is one link for the exercise itself, written as text. demoLinks maps the name of a substitution to its link, like {"Dumbbell press":"https://youtu.be/abc"}, with every value written as text. Leave both out when the source has no links. Demo links must name a real video or guide on an approved host: {{{string.Join(", ", ImportDemoLinks.ApprovedHosts.Order())}}}; omit unsupported links and report them to the user. YouTube links must name a video.
        Source references are {"kind":"pdfPage","page":2}, {"kind":"sheetCell","sheet":"Plan","cell":"A1:B3"}, {"kind":"text","text":"Section 2"}, or {"kind":"none"}. Alternatives use alternativeGroups with id, kind (program or week), and members. Each member has id, name, dayKeys, optional description and uncertainty. Every member needs its own explicit days; each day key may appear once across groups. No overlapping or nested alternative groups.
        Decisions to make yourself, without asking:
        - A set count given as a range (such as 1-3): use the lowest number and mark that exercise uncertain.
        - A row that gives a number of warm-up sets without reps or loads: add that many sets of type warmup ahead of the working sets, with no reps or load. Leave general warm-up routines out of the daily exercise lists.
        - A main lift printed as a top-set row followed by back-off rows under the same name: keep them as separate consecutive exercises, exactly as printed.
        - More alternatives for an exercise than the limit allows: use the alternatives printed on the exercise's own row first, then those from any substitutions list, up to {{{ExternalImportLimits.MaxSubstitutions}}} in total, and mention the rest in the exercise notes. Do not mark this uncertain.
        - Rest days: create a rest day only where the source prints one. Do not pad weeks to seven days.
        - Optional days or exercises: include them as ordinary days or exercises in the weeks where the source lists them, and write Optional in the day name or exercise notes.
        - Versions the user must choose between (such as Week 10A and Week 10B, or Option A and Option B): include every version and describe them in alternativeGroups with kind week or program; the app asks the user which to follow, so do not ask.
        - A rep notation that is not a plain number or range (such as 3/3, 10 sec or AMRAP): leave repMin and repMax out and keep the printed text in repsText. Do not mark this uncertain.
        Use only the named fields. Do not supply internal identifiers or claims that WorkoutApp has verified the content. If part of the source cannot fit this format, keep what you can, put the rest in notes, and mention it in your final message; do not ask the user what to do.
        When you reply to the user, use plain, everyday language. Do not mention JSON field names, formats or limits. Give the file, then at most three short sentences about anything you could not read clearly.
        """;
}
