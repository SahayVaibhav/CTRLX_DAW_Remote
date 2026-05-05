on run
  set launcherPath to "/Users/kuhusingh/Documents/New codex project/CTRLX_Dev_Stage/scripts/launch-host.sh"
  set shellCommand to "nohup " & quoted form of launcherPath & " >/dev/null 2>&1 &"
  do shell script "/bin/zsh -lc " & quoted form of shellCommand
end run
