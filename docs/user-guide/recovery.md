# Recovery

Dirty documents are archived after a 1.5-second debounce in the application recovery directory. Each document has independent metadata, v4 archive, and optional thumbnail. One corrupt record does not prevent other recoveries from appearing.

A recovered document opens dirty and does not reuse or overwrite the original file automatically, even if the original moved or disappeared. Choose Save As after checking the result. Successful save and clean close remove obsolete recovery data; Clear Recovery is destructive and requires deliberate confirmation in the recovery dialog.
