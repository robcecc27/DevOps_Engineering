## Core `.vimrc` (drop this in `~/.vimrc`)

```vim
" =========================
" General Settings
" =========================
set nocompatible
syntax on
filetype plugin indent on

" Line numbers
set number
set relativenumber

" Better scrolling
set scrolloff=5
set sidescrolloff=5

" Search improvements
set ignorecase
set smartcase
set incsearch
set hlsearch

" Tabs & indentation (sane defaults)
set tabstop=2
set shiftwidth=2
set expandtab
set autoindent
set smartindent

" Show invisible characters (spaces, tabs, etc)
set list
set listchars=tab:»·,trail:·,extends:>,precedes:<,space:·

" Highlight current line
set cursorline

" Better backspace behavior
set backspace=indent,eol,start

" Faster updates
set updatetime=300

" Enable mouse (optional but useful in tmux sometimes)
set mouse=a

" Clipboard (works in most modern systems)
set clipboard=unnamedplus
```

---

## 🔍 YAML-Specific Settings (this is where you win)

YAML is brutal about spacing. You want **visual clarity + enforced rules**.

```vim
" =========================
" YAML Settings
" =========================
autocmd FileType yaml setlocal tabstop=2 shiftwidth=2 expandtab
autocmd FileType yaml setlocal list
autocmd FileType yaml setlocal cursorcolumn
autocmd FileType yaml setlocal colorcolumn=81
```

### What this gives you:

* **Visible tabs/spaces** → prevents invisible indentation bugs
* **2-space enforcement** → YAML standard
* **cursorcolumn** → highlights vertical alignment
* **colorcolumn=81** → keeps lines readable (optional but useful)

---

##  Optional: Stronger Visual Indentation Guides (Highly Recommended)

Vanilla Vim is okay, but this is where plugins help. If you want a clean native approach:

```vim
" Highlight indentation levels (basic)
set listchars+=leadmultispace:·
```

But honestly—this is one place I’d push you:

 Use `indentLine` or `ibl` (if you ever move to Neovim)

---

##  Quality-of-Life Improvements

```vim
" Easier splits
set splitbelow
set splitright

" Show matching brackets
set showmatch

" Better command-line completion
set wildmenu

" Save undo history
set undofile

" Faster escape from insert mode
inoremap jk <Esc>
```

---

## My Opinion (based on how you work)

Given your DevOps/AWS work:

* YAML mistakes = pipeline failures → **you want aggressive whitespace visibility**
* You should **always keep `set list` ON**, not just for YAML
* Relative line numbers help with quick movement (you’ll get used to it fast)
* Keep it minimal. Don’t turn Vim into an IDE—you already use VSCode where needed

---

## If You Want One Level Up

If you’re open to it later, I’d push you toward:

* `vim-plug` for lightweight plugin management
* `ale` or `yamllint` integration for YAML validation
* `fzf` for file navigation (huge productivity gain)
