using Microsoft.EntityFrameworkCore;

namespace Workout.Api.Data;

public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public Guid? CurrentUser { get; set; }
    public bool MaintenanceAccess { get; set; }
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<AuthSession> Sessions => Set<AuthSession>();
    public DbSet<Exercise> Exercises => Set<Exercise>();
    public DbSet<ExerciseAlias> Aliases => Set<ExerciseAlias>();
    public DbSet<TrainingProgram> Programs => Set<TrainingProgram>();
    public DbSet<WorkoutTemplate> Templates => Set<WorkoutTemplate>();
    public DbSet<TemplateExercise> TemplateExercises => Set<TemplateExercise>();
    public DbSet<WorkoutSession> Workouts => Set<WorkoutSession>();
    public DbSet<SessionExercise> SessionExercises => Set<SessionExercise>();
    public DbSet<CompletedSet> Sets => Set<CompletedSet>();
    public DbSet<AiImport> Imports => Set<AiImport>();
    public DbSet<AiUsage> Usage => Set<AiUsage>();
    public DbSet<MutationReceipt> Receipts => Set<MutationReceipt>();

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<AppUser>().HasIndex(x => x.Username).IsUnique();
        m.Entity<AppUser>().HasIndex(x => x.Slot).IsUnique();
        m.Entity<AppUser>().Property(x => x.Username).HasMaxLength(80);
        m.Entity<AppUser>().Property(x => x.Unit).HasDefaultValue("kg");
        m.Entity<AppUser>().Property(x => x.Theme).HasDefaultValue("dark");
        m.Entity<AppUser>().Property(x => x.RestSeconds).HasDefaultValue(90);
        m.Entity<AppUser>().ToTable("Users", t =>
        {
            t.HasCheckConstraint("CK_Users_Unit", "\"Unit\" IN ('kg','lb')");
            t.HasCheckConstraint("CK_Users_Theme", "\"Theme\" IN ('dark','light')");
            t.HasCheckConstraint("CK_Users_RestSeconds", "\"RestSeconds\" >= 0 AND \"RestSeconds\" <= 600");
        });

        m.Entity<AuthSession>().HasKey(x => x.Hash);
        m.Entity<AuthSession>().HasIndex(x => x.Expires);
        m.Entity<AuthSession>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);

        // The catalog is global: no tenant filter, and users never write it.
        m.Entity<Exercise>().HasIndex(x => x.Slug).IsUnique();
        m.Entity<Exercise>().Property(x => x.Slug).HasMaxLength(120);
        m.Entity<Exercise>().Property(x => x.Name).HasMaxLength(160);
        m.Entity<ExerciseAlias>().HasIndex(x => x.Normalized).IsUnique();
        m.Entity<ExerciseAlias>().HasOne<Exercise>().WithMany().HasForeignKey(x => x.ExerciseId).OnDelete(DeleteBehavior.Cascade);

        Configure<TrainingProgram>(m); Configure<WorkoutTemplate>(m); Configure<TemplateExercise>(m);
        Configure<WorkoutSession>(m); Configure<SessionExercise>(m); Configure<CompletedSet>(m); Configure<AiImport>(m);

        // One active program and one active workout per user, enforced by the database.
        m.Entity<TrainingProgram>().HasIndex(x => x.UserId).IsUnique().HasFilter("\"Active\"").HasDatabaseName("IX_Programs_ActivePerUser");
        m.Entity<WorkoutSession>().HasIndex(x => x.UserId).IsUnique().HasFilter("\"Active\"").HasDatabaseName("IX_Workouts_ActivePerUser");
        m.Entity<WorkoutTemplate>().HasIndex(x => new { x.UserId, x.ProgramId, x.Week, x.Position });
        m.Entity<TemplateExercise>().HasIndex(x => new { x.UserId, x.TemplateId, x.Position });
        m.Entity<SessionExercise>().HasIndex(x => new { x.UserId, x.SessionId, x.Position });
        m.Entity<CompletedSet>().HasIndex(x => new { x.UserId, x.SessionExerciseId, x.Position });
        m.Entity<WorkoutSession>().HasIndex(x => new { x.UserId, x.FinishedAt });
        m.Entity<AiImport>().HasIndex(x => new { x.UserId, x.DocumentHash, x.PromptVersion });
        m.Entity<AiImport>().ToTable("Imports", t =>
        {
            t.HasCheckConstraint("CK_Imports_Status", "\"Status\" IN ('pending','ready','failed','accepted','discarded')");
            t.HasCheckConstraint("CK_Imports_Stage", "\"Stage\" IN ('outline','extract','done')");
        });
        m.Entity<CompletedSet>().ToTable("Sets", t =>
        {
            t.HasCheckConstraint("CK_Sets_Weight", "\"WeightKg\" IS NULL OR (\"WeightKg\" >= 0 AND \"WeightKg\" <= 1000)");
            t.HasCheckConstraint("CK_Sets_Reps", "\"Reps\" IS NULL OR (\"Reps\" > 0 AND \"Reps\" <= 1000)");
            // RPE is 1-10 in half-point steps; doubling must land on a whole number.
            t.HasCheckConstraint("CK_Sets_Rpe", "\"Rpe\" IS NULL OR (\"Rpe\" >= 1 AND \"Rpe\" <= 10 AND \"Rpe\" * 2 = FLOOR(\"Rpe\" * 2))");
            // A completed set is a real observation: it must carry reps and an RPE.
            t.HasCheckConstraint("CK_Sets_Done", "NOT \"Done\" OR (\"Reps\" IS NOT NULL AND \"Rpe\" IS NOT NULL)");
        });

        m.Entity<AiUsage>().HasKey(x => new { x.UserId, x.Date });
        m.Entity<AiUsage>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<AiUsage>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        m.Entity<MutationReceipt>().HasKey(x => new { x.UserId, x.Id });
        m.Entity<MutationReceipt>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<MutationReceipt>().HasIndex(x => x.Created);
        m.Entity<MutationReceipt>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }

    private void Configure<T>(ModelBuilder m) where T : OwnedRecord
    {
        m.Entity<T>().HasBaseType((Type?)null);
        m.Entity<T>().HasKey(x => new { x.UserId, x.Id });
        m.Entity<T>().HasQueryFilter(x => x.UserId == CurrentUser);
        m.Entity<T>().Property(x => x.Revision).IsConcurrencyToken();
        m.Entity<T>().HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries<OwnedRecord>().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            if (!MaintenanceAccess && (CurrentUser == null || entry.Entity.UserId != CurrentUser))
                throw new InvalidOperationException("Record ownership violation.");
            if (entry.State != EntityState.Added && entry.Property(x => x.UserId).IsModified)
                throw new InvalidOperationException("Record ownership cannot change.");
        }
        foreach (var entry in ChangeTracker.Entries<MutationReceipt>().Where(e => e.State is EntityState.Added or EntityState.Modified))
            if (entry.Entity.UserId != CurrentUser) throw new InvalidOperationException("Receipt ownership violation.");
        foreach (var entry in ChangeTracker.Entries<AiUsage>().Where(e => e.State is EntityState.Added or EntityState.Modified))
            if (!MaintenanceAccess && entry.Entity.UserId != CurrentUser) throw new InvalidOperationException("Usage ownership violation.");
        // Only the seed command may write the shared catalog.
        foreach (var entry in ChangeTracker.Entries<Exercise>().Where(e => e.State != EntityState.Unchanged))
            if (!MaintenanceAccess) throw new InvalidOperationException("The exercise catalog is read-only.");
        foreach (var entry in ChangeTracker.Entries<ExerciseAlias>().Where(e => e.State != EntityState.Unchanged))
            if (!MaintenanceAccess) throw new InvalidOperationException("The exercise catalog is read-only.");
        return base.SaveChangesAsync(cancellationToken);
    }
}
