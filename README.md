# CodePal

Have a coding pal of your choice react to the number of errors in your code. Concept blatantly stolen from [virejdasani](https://github.com/virejdasani/InYourFace), but extended to allow for custom and several pals.

## Features

- Register multiple pals, each with their own set of images.
- Choose an active pal to display in the sidebar.
- Automatically updates images based on the number of errors in your code.
- Panic limit configuration: define the error threshold for maximum reaction.


## Usage
### Commands

All commands are accessible via the Command Palette (Ctrl+Shift+P / Cmd+Shift+P):

* `CodePal: Register Pal`
Create a new pal. This copies a template pal and sets it as the active pal. You can open its folder immediately after registration.

* `CodePal: Choose Active Pal`
Switch between registered pals. The active pal will respond to code errors in the sidebar.

* `CodePal: Delete Pal`
Delete a registered pal permanently

* `CodePal: Open Pals Directory`
Open the folder containing all registered pals in your system’s file explorer.

* `CodePal: Set Panic Limit`
Define the number of errors required for the topmost image level. Default is 20.

### Configuration

You can configure the panic limit globally:

`"codepal.panicLimit": 30`


panicLimit: Number of errors before the pal shows the topmost reaction image.

### Pals Directory

Default path: `<extension-folder>/pals`

Each pal has its own folder containing numbered subfolders (0, 1, 2...) with images.

Images can be any format supported by the browser: .png, .jpg, .jpeg, .gif.

Any level (0, 1, 2...) can have any number of images, that are selected between at random.

### Logic (lol)

The images in folder 0 are always used when there are 0 errors in your code (as if), and the images in the folder iwth the highest number are selected when there are more than or equal errors as your set panic limit.

**Example:**

Folders 1, 2, 3 exist. Panic limit is 10.
```
Errors:          0          5          10
                 ║----------║-----------║------->
Image folder:    0|----1----|-----2-----|---3--->
```

### Example Folder Structure
```
pals/
├─ HappyPal/
│  ├─ 0/
│  │  └─ idle.png
│  ├─ 1/
│  │  └─ concerned.png
│  └─ 2/
│     └─ panicking.png
└─ CoolPal/
   └─ ...
```
### Tips

Keep images consistent in aspect ratio for the smoothest visual effect.

Use multiple images per level for randomness in displayed pictures.

You can edit or replace pal images directly in the pals folder.

## Release Notes


### 1.0.0

Initial release. Prolly also the last.
