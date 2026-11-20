Drop image files in this folder and describe each one in manifest.json.

manifest.json is a list of entries:
  {
    "file":     "robotics-lab.jpg",      <- must match a real file in this folder
    "category": "labs",                   <- free label (labs, senior-projects, campus, ...)
    "caption":  "Short sentence shown under the image and used for matching.",
    "tags":     ["lab", "robotics", ...]  <- keywords AURA matches against questions
  }

After adding or editing entries, rebuild the brain so AURA can find them:
  cd backend
  .\venv\Scripts\Activate.ps1
  python -m tools.ingest

The sample entries reference robotics-lab.jpg, computer-lab.jpg, and senior-project-expo.jpg.
Add those files (or edit the manifest to match the images you actually have).
