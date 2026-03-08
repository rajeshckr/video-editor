const fs = require('fs');
const path = require('path');

/**
 * Prompt Loader Utility
 * Loads prompt templates from filesystem and replaces placeholders
 */

const PROMPTS_DIR = path.join(__dirname, '../prompts');
const FRAGMENTS_DIR = path.join(PROMPTS_DIR, 'fragments');

/**
 * Load a prompt fragment from the fragments directory
 * @param {string} fragmentName - Name of the fragment file (without .txt extension)
 * @returns {string} The fragment content
 */
function loadFragment(fragmentName) {
  const fragmentPath = path.join(FRAGMENTS_DIR, `${fragmentName}.txt`);
  
  if (!fs.existsSync(fragmentPath)) {
    return ''; // Return empty string if fragment doesn't exist
  }
  
  return fs.readFileSync(fragmentPath, 'utf8');
}

/**
 * Load a prompt template from file and replace placeholders
 * @param {string} promptName - Name of the prompt file (without .txt extension)
 * @param {Object} variables - Key-value pairs to replace in the prompt (e.g., {transcript: "..."})
 * @returns {string} The prompt with placeholders replaced
 */
function loadPrompt(promptName, variables = {}) {
  const promptPath = path.join(PROMPTS_DIR, `${promptName}.txt`);
  
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt template not found: ${promptName}.txt`);
  }
  
  let promptContent = fs.readFileSync(promptPath, 'utf8');
  
  // Replace all placeholders in format {variableName}
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    promptContent = promptContent.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
  }
  
  return promptContent;
}

/**
 * Check if a prompt template exists
 * @param {string} promptName 
 * @returns {boolean}
 */
function promptExists(promptName) {
  const promptPath = path.join(PROMPTS_DIR, `${promptName}.txt`);
  return fs.existsSync(promptPath);
}

/**
 * List all available prompt templates
 * @returns {string[]} Array of prompt names (without .txt extension)
 */
function listPrompts() {
  if (!fs.existsSync(PROMPTS_DIR)) {
    return [];
  }
  
  return fs.readdirSync(PROMPTS_DIR)
    .filter(file => file.endsWith('.txt'))
    .map(file => file.replace('.txt', ''));
}

module.exports = {
  loadPrompt,
  loadFragment,
  promptExists,
  listPrompts
};
