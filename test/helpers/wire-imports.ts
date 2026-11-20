/** Re-export the server wire serializers for unit tests (the server module
 * tree is not directly importable from every test context). */
export { editorStateToJson, jsonToEditorState } from "../../src/server/serialize.ts";
