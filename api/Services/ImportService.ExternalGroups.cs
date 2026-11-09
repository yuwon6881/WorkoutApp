using Workout.Api.Domain;

namespace Workout.Api.Services;

public sealed partial class ImportService
{
    private static List<ImportAlternativeGroup> ExternalGroups(List<ExternalAlternativeGroup>? input, Dictionary<string, Guid> dayKeys)
    {
        var output = new List<ImportAlternativeGroup>();
        var groupKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var usedDays = new HashSet<Guid>();
        foreach (var (group, groupIndex) in (input ?? []).Select((item, index) => (item, index)))
        {
            var groupPath = $"$.program.alternativeGroups[{groupIndex}]";
            ExternalImportPath.At(groupPath, () => Validation.Require(group is not null, "Add the missing alternative group."));
            ExternalImportPath.At(groupPath + ".id", () => {
                Validation.Name(group!.Id, "Alternative group id", 120);
                Validation.Require(groupKeys.Add(group.Id), "Give each alternative group a unique id; this id is duplicate.");
            });
            ExternalImportPath.At(groupPath + ".kind", () => Validation.Require(group!.Kind is "program" or "week", "Set the alternative group kind to program or week."));
            ExternalImportPath.At(groupPath + ".members", () => Validation.Require(group!.Members is { Count: >= 2 and <= 40 }, "Add between 2 and 40 alternative members."));
            var members = new List<ImportAlternative>();
            var memberKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (member, memberIndex) in group!.Members!.Select((item, index) => (item, index)))
            {
                var memberPath = $"{groupPath}.members[{memberIndex}]";
                ExternalImportPath.At(memberPath, () => Validation.Require(member is not null, "Add the missing alternative."));
                ExternalImportPath.At(memberPath + ".id", () => {
                    Validation.Name(member!.Id, "Alternative id", 120);
                    Validation.Require(memberKeys.Add(member.Id), "Give each alternative a unique id; this id is duplicate.");
                });
                ExternalImportPath.At(memberPath + ".name", () => Validation.Name(member!.Name, "Alternative name", 200));
                ExternalImportPath.At(memberPath + ".description", () => Validation.Text(member!.Description, 1000, "Alternative description"));
                ExternalImportPath.At(memberPath + ".uncertainty", () => ImportUncertainty.Validate(member!.Uncertainty));
                ExternalImportPath.At(memberPath + ".dayKeys", () => Validation.Require(member!.DayKeys is { Count: > 0 }, "Add at least one day key to each alternative."));
                var ids = new List<Guid>();
                foreach (var key in member!.DayKeys!)
                {
                    ExternalImportPath.At(memberPath + ".dayKeys", () => {
                        Validation.Require(key is not null && dayKeys.TryGetValue(key, out _), "Use day keys that exist in the program.");
                        Validation.Require(usedDays.Add(dayKeys[key!]), "Use each day key only once across all alternative members.");
                    });
                    ids.Add(dayKeys[key!]);
                }
                members.Add(new ImportAlternative(Guid.NewGuid().ToString(), member.Name, ids.Count,
                    Kind: group.Kind, Description: member.Description, DayLineIds: ids) { Uncertainty = member.Uncertainty });
            }
            output.Add(new ImportAlternativeGroup(Guid.NewGuid().ToString(), members));
        }
        return output;
    }
}
