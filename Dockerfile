FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY api/ api/
RUN dotnet restore api/Workout.Api.csproj -r linux-x64 -p:PublishReadyToRun=true
RUN dotnet publish api/Workout.Api.csproj -c Release -r linux-x64 --no-restore --self-contained false -p:PublishReadyToRun=true -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /out/ ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Workout.Api.dll"]
