# Spec: Update and Delete Notes

## High Level Objectives

**Update Note:**
As a user, I want to edit an existing note, so that I can update its content with new information.

**Delete Note:**
As a user, I want to delete a note that I no longer need, so that I can keep my note list clean and organized.

## Low-level Objectives

- **Update Note:**
  - Create a `PUT /notes/:id` endpoint to handle note updates.
  - Implement an editable view that appears when a user clicks an "Edit" button.
  - The view will contain a form with the note's current content, allowing the user to make changes.
  - On submission, the note will be updated in the database, and the UI will reflect the changes.
- **Delete Note:**
  - Create a `DELETE /notes/:id` endpoint to handle note deletion.
  - Add a "Delete" button to each note.
  - When a user clicks the "Delete" button, the note will be removed from the database and the UI.
- **Testing:**
  - Add UI, integration, and unit tests for both update and delete functionality.

## 1. Overview

This specification outlines the implementation of editing and deleting notes. These are core features for any note-taking application, allowing users to manage their content effectively.

## 2. Core Concepts

### 2.1 User Experience

- **Editing:** Users will be able to click on a note to view it, and then click an "Edit" button to enter an editing mode. This provides a clear separation between viewing and editing states.
- **Deleting:** A confirmation step can be added to prevent accidental deletions, for instance, by using the `hx-confirm` attribute in HTMX.

### 2.2 Backend Logic

- **Update (`PUT /notes/:id`):** This endpoint will take the updated content from the request body and update the corresponding note in the database.
- **Delete (`DELETE /notes/:id`):** This endpoint will remove the note with the specified ID from the database.

## 3. Implementation Details

### 3.1 Frontend (`public/index.html`)

- When a note is selected and displayed, "Edit" and "Delete" buttons will be visible.
- **Edit Button:** Will trigger a `GET /notes/:id/edit` request to fetch an editable form.
- **Edit Form:** Will be an HTML form pre-filled with the note's data, which submits a `PUT /notes/:id` request.
- **Delete Button:** Will be a button with an `hx-delete="/notes/:id"` attribute to trigger the deletion.

### 3.2 Backend (`src/main.ts`)

- **`GET /notes/:id/edit`:** A new handler to return an HTML form for editing a specific note.
- **`PUT /notes/:id`:** A new handler to update a note in the database.
- **`DELETE /notes/:id`:** A new handler to delete a note from the database.

### 3.3 Database (`src/db.ts`)

- **`updateNote()`:** A new function to update an existing note in the `notes` table.
- **`deleteNote()`:** A new function to delete a note from the `notes` table.

## 4. Testing Strategy

- **UI Tests (`test/ui.test.ts`):**
  - Test that clicking the "Edit" button shows the edit form.
  - Test that submitting the edit form updates the note content on the page.
  - Test that clicking the "Delete" button removes the note from the list.
- **Integration Tests (`test/main.test.ts`):**
  - Add tests for the new `GET /notes/:id/edit`, `PUT /notes/:id`, and `DELETE /notes/:id` endpoints.
- **Unit Tests (`test/db.test.ts`):**
  - Add tests for the new `updateNote` and `deleteNote` functions.

## 5. Benefits

- **Full CRUD Functionality:** Completes the core Create, Read, Update, and Delete operations for notes.
- **User Empowerment:** Gives users full control over their created content.

## 6. File Structure

```
.
├── public/
│   └── index.html      # Modified
├── specs/
│   └── update-delete-notes.md # This document
├── src/
│   ├── main.ts         # Modified
│   └── db.ts           # Modified
└── test/
    ├── main.test.ts    # Modified
    ├── db.test.ts      # Modified
    └── ui.test.ts        # Modified
```

## 7. Affected Files

- **Modified Files:**
  - `public/index.html`
  - `src/main.ts`
  - `src/db.ts`
  - `test/main.test.ts`
  - `test/db.test.ts`
  - `test/ui.test.ts`
