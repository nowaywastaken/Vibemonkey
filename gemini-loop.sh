RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TARGET_DIR="$HOME/Documents/Vibemonkey"
PROMPT_FILE="$HOME/Desktop/PROMPT.md"

# Help function
usage() {
    echo "Usage: $0 [-d target_dir] [-p prompt_file] [-r remote_name]"
    exit 1
}

REMOTE="Vibemonkey"

while getopts "d:p:r:h" opt; do
    case $opt in
        d) TARGET_DIR="$OPTARG" ;;
        p) PROMPT_FILE="$OPTARG" ;;
        r) REMOTE="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

# Realpath fallback for macOS
my_realpath() {
    if command -v realpath > /dev/null 2>&1; then
        realpath "$1"
    else
        [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"
    fi
}

TARGET_DIR=$(my_realpath "${TARGET_DIR/#\~/$HOME}")
if [[ -z "$PROMPT_FILE" ]]; then
    PROMPT_FILE="$TARGET_DIR/PROMPT.md"
else
    PROMPT_FILE=$(my_realpath "${PROMPT_FILE/#\~/$HOME}")
fi

echo "${GREEN}Starting Gemini Auto Loop & Commit script (YOLO mode)...${NC}"
echo "${YELLOW}Target Directory: $TARGET_DIR${NC}"
echo "${YELLOW}Prompt File: $PROMPT_FILE${NC}"

if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "${RED}Error: Prompt file not found: $PROMPT_FILE${NC}"
    exit 1
fi

if [[ ! -d "$TARGET_DIR" ]]; then
    echo "${RED}Error: Target directory does not exist: $TARGET_DIR${NC}"
    exit 1
fi

cd "$TARGET_DIR" || exit 1

if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo "${YELLOW}Notice: Target directory is not a git repository, initializing...${NC}"
    git init
fi

if ! command -v gemini > /dev/null 2>&1; then
    echo "${RED}Error: gemini command not found.${NC}"
    exit 1
fi

ITERATION=1

while :; do
    echo "\n${YELLOW}--- Iteration #$ITERATION ---${NC}"
    echo "${GREEN}AI is working... (Reading $PROMPT_FILE)${NC}"
    
    cat "$PROMPT_FILE" | gemini --yolo
    
    if [[ -n $(git status -s) ]]; then
        echo "${GREEN}Changes detected, preparing to generate commit message...${NC}"
        
        git add .
        
        COMMIT_MSG=$(git diff --cached | gemini --yolo --prompt "Based on the code changes above, write a concise Git commit message. Requirements: 1. Output ONLY the message content; 2. No Markdown formatting or quotes; 3. Keep it under 50 characters.")
        
        if [[ -z "$COMMIT_MSG" ]]; then
            COMMIT_MSG="auto: completed AI iteration #$ITERATION (YOLO)"
        fi
        
        echo "${GREEN}Committing: $COMMIT_MSG${NC}"
        git commit -m "$COMMIT_MSG"

        # Push to remote if configured
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        if git remote | grep -q "^$REMOTE$"; then
            echo "${GREEN}Pushing to $REMOTE $CURRENT_BRANCH...${NC}"
            git push "$REMOTE" "$CURRENT_BRANCH"
        else
            echo "${YELLOW}Remote '$REMOTE' not found, skipping push.${NC}"
        fi
    else
        echo "${YELLOW}No changes detected, skipping commit.${NC}"
    fi
    
    ITERATION=$((ITERATION + 1))
    
    sleep 2
done
